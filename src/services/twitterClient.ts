import { TwitterApi } from 'twitter-api-v2';
import { logger } from '@elizaos/core';

function getEnv(name: string, fallbackNames: string[] = []): string | undefined {
  if (process.env[name]?.trim()) return process.env[name] as string;
  for (const alt of fallbackNames) {
    if (process.env[alt]?.trim()) return process.env[alt] as string;
  }
  return undefined;
}

let apiCooldownUntilMs = 0; // 429后本地冷却时间戳

export function createTwitterClient(): TwitterApi | null {
  const appKey = getEnv('TWITTER_API_KEY', ['TWITTER_APP_KEY']);
  const appSecret = getEnv('TWITTER_API_SECRET_KEY', ['TWITTER_APP_SECRET']);
  const accessToken = getEnv('TWITTER_ACCESS_TOKEN', ['TWITTER_ACCESS_TOKEN_KEY']);
  const accessSecret = getEnv('TWITTER_ACCESS_TOKEN_SECRET', ['TWITTER_ACCESS_TOKEN_SECRET']);

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    logger.warn('Twitter credentials missing, X posting disabled.');
    return null;
  }

  return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
}

export async function postTweet(text: string): Promise<string | null> {
  const enabled = (process.env.X_POST_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    logger.info('X posting disabled via X_POST_ENABLED=false');
    return null;
  }
  // 若处于429冷却期，跳过API，让上层走浏览器兜底
  if (Date.now() < apiCooldownUntilMs) {
    const waitSec = Math.ceil((apiCooldownUntilMs - Date.now()) / 1000);
    logger.warn({ waitSec }, 'X API in cooldown (previous 429), skipping API post');
    return null;
  }

  const client = createTwitterClient();
  if (!client) return null;
  try {
    const result = await client.v2.tweet(text);
    logger.info({ id: result.data.id }, 'Tweet posted');
    return result.data.id;
  } catch (error) {
    // 429处理：设置冷却，优先使用返回的rateLimit重置时间
    const e: any = error;
    const status = e?.code || e?.statusCode || e?.data?.status;
    if (status === 429 || String(e).includes('429')) {
      const resetMs = (() => {
        const rl = e?.rateLimit;
        if (rl?.reset) {
          const now = Math.floor(Date.now() / 1000);
          const delta = Math.max(0, rl.reset - now);
          return Date.now() + delta * 1000;
        }
        // 默认冷却15分钟
        return Date.now() + 15 * 60 * 1000;
      })();
      apiCooldownUntilMs = resetMs;
      logger.warn({ resetAt: new Date(resetMs).toISOString() }, 'X API 429 rate limited, entering cooldown');
      return null; // 让上层走浏览器兜底
    }
    logger.error({ error }, 'Failed to post tweet');
    return null;
  }
}


