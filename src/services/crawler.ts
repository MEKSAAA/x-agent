import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import * as cheerio from 'cheerio';
import { loadSeenLinks, saveSeenLinks } from '../utils/storage.ts';
import { postTweet } from './twitterClient.ts';

function toAbsoluteUrl(baseUrl: string, href: string): string | null {
  try {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;
    const url = new URL(href, baseUrl);
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchLinksFromUrl(url: string): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    const abs = toAbsoluteUrl(url, href || '');
    if (abs) links.add(abs);
  });
  return Array.from(links);
}

export class CrawlerService extends Service {
  static serviceType = 'crawler';
  private intervalHandle: any = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    const service = new CrawlerService(runtime);
    await service.startLoop();
    return service;
  }

  private parseConfig() {
    const urls = (process.env.CRAWL_URLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const minutes = parseInt(process.env.CRAWL_INTERVAL_MINUTES || '10', 10);
    const postOnNew = (process.env.X_POST_ON_NEW_LINK || 'true').toLowerCase() !== 'false';
    return { urls, minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 10, postOnNew };
  }

  private async startLoop() {
    const { minutes } = this.parseConfig();
    const ms = minutes * 60 * 1000;
    await this.tick();
    this.intervalHandle = setInterval(() => this.tick().catch((e) => logger.error(e, 'crawler tick error')), ms);
  }

  async stop() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  private async tick() {
    const { urls, postOnNew } = this.parseConfig();
    if (urls.length === 0) {
      logger.warn('CRAWL_URLS not configured. Skipping crawl.');
      return;
    }
    const seen = await loadSeenLinks();
    for (const url of urls) {
      try {
        const links = await fetchLinksFromUrl(url);
        const newOnes = links.filter((l) => !seen.has(l));
        if (newOnes.length) {
          logger.info({ count: newOnes.length }, 'New links found');
        }
        for (const link of newOnes) {
          seen.add(link);
          if (postOnNew) {
            const text = `新鲜出炉：${link}\n#crypto #web3 #XAgent`;
            await postTweet(text);
          }
        }
        if (newOnes.length) await saveSeenLinks(seen);
      } catch (error) {
        logger.error({ error, url }, 'Crawl error');
      }
    }
  }
}


