import { Service, type IAgentRuntime, logger, ModelType } from '@elizaos/core';
import { postTweet } from './twitterClient.ts';

// 中文：读取布尔型环境变量
function getBool(name: string, def = 'false'): boolean {
  return (process.env[name] ?? def).toLowerCase() === 'true';
}

// 中文：读取逗号分隔列表
function getList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export class MentionReplyService extends Service {
  static serviceType = 'mention_reply_service';
  capabilityDescription = 'Poll X mentions and replies, generate responses via LLM, and post.';
  private timer: any = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    const svc = new MentionReplyService(runtime);
    await svc.start();
    return svc;
  }

  // 中文：按频率轮询 mentions/replies，命中策略则生成与发布回复
  async start(): Promise<void> {
    if (!getBool('REPLY_ENABLED', 'false')) {
      logger.info('MentionReplyService disabled via REPLY_ENABLED=false');
      return;
    }
    const minutes = parseInt(process.env.REPLY_POLL_MINUTES || '10', 10);
    const ms = (Number.isFinite(minutes) && minutes > 0 ? minutes : 10) * 60 * 1000;
    await this.tickSafe();
    this.timer = setInterval(() => this.tickSafe(), ms);
    logger.info({ everyMinutes: minutes }, 'MentionReplyService started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  private async tickSafe() {
    try { await this.tick(); } catch (e) { logger.error({ e }, 'MentionReply tick error'); }
  }

  // 中文：获取待处理的 mentions/replies（需你接入 X API 或 Playwright）
  private async fetchIncoming(): Promise<{ id: string; text: string; author?: string }[]> {
    // TODO：接 X mentions/replies API 或通过 Playwright 抓取
    return [];
  }

  // 中文：基于关键词白/黑名单决定是否回复
  private shouldReply(text: string): boolean {
    const must = getList('REPLY_KEYWORDS');
    const block = getList('REPLY_BLOCKWORDS');
    const t = text.toLowerCase();
    if (block.some((b) => t.includes(b.toLowerCase()))) return false;
    if (must.length === 0) return true;
    return must.some((k) => t.includes(k.toLowerCase()));
  }

  // 中文：调用模型生成回复文本
  private async generateReply(text: string): Promise<string | null> {
    try {
      const prompt = [
        'You are CommiEcho — playful, witty, inclusive. Reply on X with meme vibe.',
        'Constraints: ≤120 chars; human tone; 1 light CTA/question; 0 corporate/over-technical; optional emoji + 1 tag (#CommiFam preferred).',
        `User text: ${text}`,
        'Output only the reply text.',
      ].join('\n');
      const out = await this.runtime.useModel?.(ModelType.TEXT_LARGE, {
        prompt,
        temperature: 0.5,
        maxTokens: 180,
      });
      if (typeof out === 'string') return out.trim();
      return null;
    } catch (e) {
      logger.error({ e }, 'generateReply failed');
      return null;
    }
  }

  // 中文：轮询一次，逐条判定与回复
  private async tick(): Promise<void> {
    const incoming = await this.fetchIncoming();
    for (const msg of incoming) {
      if (!this.shouldReply(msg.text)) continue;
      const reply = await this.generateReply(msg.text);
      if (!reply) continue;
      // 简化：直接发推；理想是回复到线程（需 tweetId）
      await postTweet(reply).catch((e) => logger.error({ e }, 'postTweet failed'));
    }
  }
}
