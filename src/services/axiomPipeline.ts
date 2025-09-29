import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { chromium } from 'playwright';
import { crawlAxiomTrending } from './axiomCrawler.ts';
import { appendRun, listCommunities, markCommunity } from './jsonDb.ts';
import { generatePostTexts } from './content.ts';
import { ModelType } from '@elizaos/core';
import { generatePersonalTweet, generateCommunityPost } from './copywriting.ts';
import { postTweet } from './twitterClient.ts';
import { canPostMoreToday, canPostThisHour } from './rateLimiter.ts';
import { postToCommunity, postToPersonalViaBrowser, fetchCommunityMeta } from './communityPoster.ts';

function getList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function randomDelay() {
  const min = parseInt(process.env.RANDOM_DELAY_MIN_SECONDS || '30', 10);
  const max = parseInt(process.env.RANDOM_DELAY_MAX_SECONDS || '120', 10);
  const secs = Math.floor(Math.random() * (max - min + 1)) + min;
  return secs * 1000;
}

function allowedByLists(ticker: string, url: string): boolean {
  const allow = getList('COMMUNITY_ALLOWLIST');
  const block = getList('COMMUNITY_BLOCKLIST');
  const t = (ticker || '').toLowerCase();
  const u = (url || '').toLowerCase();
  if (block.some((b) => t.includes(b) || u.includes(b))) return false;
  if (allow.length === 0) return true;
  return allow.some((a) => t.includes(a) || u.includes(a));
}

export class AxiomPipelineService extends Service {
  static serviceType = 'axiom_pipeline';
  capabilityDescription = 'Crawl Axiom Trending 30m, generate content, post to personal and optionally community with rate limits.';
  private intervalHandle: any = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    const autostart = (process.env.AXIOM_AUTOSTART ?? 'true').toLowerCase() !== 'false';
    const svc = new AxiomPipelineService(runtime);
    if (autostart) {
      await svc.startLoop();
    } else {
      logger.info('AxiomPipelineService autostart disabled via AXIOM_AUTOSTART=false');
    }
    return svc;
  }

  async stop() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  private getIntervalMinutes(): number {
    const minutes = parseInt(process.env.CRAWL_INTERVAL_MINUTES || '60', 10);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  }

  private async startLoop() {
    const ms = this.getIntervalMinutes() * 60 * 1000;
    await this.tickSafe();
    this.intervalHandle = setInterval(() => this.tickSafe(), ms);
  }

  private async tickSafe() {
    try {
      await this.tick();
    } catch (e) {
      logger.error({ e }, 'Axiom pipeline tick error');
    }
  }

  private async tick() {
    await runAxiomOnce();
  }
}

// 中文：进程内防重入锁，避免并发触发（如定时与手动同时触发）导致连发
let __axiomRunning = false;

export async function runAxiomOnce() {
    if (__axiomRunning) {
      logger.warn('Axiom run already in progress, skipping concurrent trigger');
      return;
    }
    __axiomRunning = true;
    try {
    const autoEnabled = (process.env.AUTO_POST_ENABLED ?? 'true').toLowerCase() !== 'false';
    const communityEnabled = (process.env.COMMUNITY_POST_ENABLED ?? 'false').toLowerCase() === 'true';
    const useLlmCopy = (process.env.USE_LLM_COPY ?? 'false').toLowerCase() === 'true';

// 中文：步骤 1）使用 Playwright 爬取 Axiom Trending
    try {
      const browser = await chromium.launch({ 
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-features=VizDisplayCompositor'
        ]
      });
      try {
        await crawlAxiomTrending(browser);
      } finally {
        await browser.close();
      }
    } catch (e) {
      await appendRun({ ts: new Date().toISOString(), action: 'crawl_discover_trending_30m', status: 'failed', error: String(e) });
    }

    // 中文：步骤 2）读取本地 communities 数据
    const all = await listCommunities();

    // 中文：2.1）给未发个人时间线的社区生成/发布推文
    const personalCandidates = all.filter((c) => !c.posted_personal_at && allowedByLists(c.ticker || '', c.x_community_url));

    for (const rec of personalCandidates) {
      // 中文：发帖前尝试抓取社区元数据（Join + 横幅 + 名称），失败不阻断
      try { await fetchCommunityMeta(rec); } catch {}

      if (!(await canPostMoreToday())) {
        await appendRun({ ts: new Date().toISOString(), action: 'rate_limit_skip', status: 'skipped', details: { reason: 'daily_limit' } });
        break;
      }
      if (!(await canPostThisHour())) {
        await appendRun({ ts: new Date().toISOString(), action: 'rate_limit_skip', status: 'skipped', details: { reason: 'hourly_limit' } });
        break;
      }

      let { personalTweet, communityPosts } = generatePostTexts(rec);
      if (useLlmCopy && (globalThis as any).runtime?.useModel) {
        try {
          const rt = (globalThis as any).runtime;
          personalTweet = await generatePersonalTweet(rt, rec);
        } catch {}
      }
      if (autoEnabled) {
        await sleep(randomDelay());
        let ok = false;
        try {
          const id = await postTweet(personalTweet);
          if (id) {
            ok = true;
            await markCommunity(rec.id, { posted_personal_at: new Date().toISOString() });
            await appendRun({ ts: new Date().toISOString(), action: 'post_personal_tweet', status: 'success', target_url: rec.x_community_url, tweet_id: id || undefined });
          }
        } catch {}
        if (!ok) {
          try {
            const out = await postToPersonalViaBrowser(personalTweet);
            ok = true;
            await markCommunity(rec.id, { posted_personal_at: new Date().toISOString() });
            await appendRun({ ts: new Date().toISOString(), action: 'post_personal_tweet', status: 'success', target_url: rec.x_community_url, details: { via: 'browser', screenshot: out?.screenshot } });
          } catch (e) {
            await appendRun({ ts: new Date().toISOString(), action: 'post_personal_tweet', status: 'failed', target_url: rec.x_community_url, error: String(e) });
          }
        }
      } else {
        await appendRun({ ts: new Date().toISOString(), action: 'post_personal_tweet', status: 'skipped', target_url: rec.x_community_url });
      }

      if (communityEnabled) {
        if (rec.posted_community_at) {
          await appendRun({ ts: new Date().toISOString(), action: 'filter_skip', status: 'skipped', target_url: rec.x_community_url, details: { reason: 'already_posted_community' } });
        } else {
          await sleep(randomDelay());
          try {
            // 发社区帖前再次确保 meta
            try { await fetchCommunityMeta(rec); } catch {}
            const first = communityPosts[0] || `社区打卡`; // 简化
            const out = await postToCommunity(rec, first);
            await appendRun({ ts: new Date().toISOString(), action: 'post_community', status: 'success', target_url: rec.x_community_url, screenshot_path: out?.screenshot });
          } catch (e) {
            await appendRun({ ts: new Date().toISOString(), action: 'post_community', status: 'failed', target_url: rec.x_community_url, error: String(e) });
          }
        }
      }
    }

    // 中文：2.2）对仍未发社区帖的条目进行补发
    if (communityEnabled) {
      const communityCandidates = all.filter((c) => !c.posted_community_at && allowedByLists(c.ticker || '', c.x_community_url));
      for (const rec of communityCandidates) {
        if (!(await canPostMoreToday())) {
          await appendRun({ ts: new Date().toISOString(), action: 'rate_limit_skip', status: 'skipped', details: { reason: 'daily_limit' } });
          break;
        }
        if (!(await canPostThisHour())) {
          await appendRun({ ts: new Date().toISOString(), action: 'rate_limit_skip', status: 'skipped', details: { reason: 'hourly_limit' } });
          break;
        }
        await sleep(randomDelay());
        try {
          try { await fetchCommunityMeta(rec); } catch {}
          let communityText = (generatePostTexts(rec).communityPosts[0]) || '社区打卡';
          if (useLlmCopy && (globalThis as any).runtime?.useModel) {
            try {
              const rt = (globalThis as any).runtime;
              communityText = await generateCommunityPost(rt, rec);
            } catch {}
          }
          const out = await postToCommunity(rec, communityText);
          await appendRun({ ts: new Date().toISOString(), action: 'post_community', status: 'success', target_url: rec.x_community_url, screenshot_path: out?.screenshot });
        } catch (e) {
          await appendRun({ ts: new Date().toISOString(), action: 'post_community', status: 'failed', target_url: rec.x_community_url, error: String(e) });
        }
      }
    }
    } finally {
      __axiomRunning = false;
    }
}
