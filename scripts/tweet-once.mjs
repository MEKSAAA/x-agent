import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';

function getEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v;
}

const appKey = getEnv('TWITTER_API_KEY');
const appSecret = getEnv('TWITTER_API_SECRET_KEY');
const accessToken = getEnv('TWITTER_ACCESS_TOKEN');
const accessSecret = getEnv('TWITTER_ACCESS_TOKEN_SECRET');

const client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });

const text = process.argv.slice(2).join(' ') || 'Onchain Koi 直发验证 🐟（非投资建议）';

async function debugError(e) {
  const err = e || {};
  const details = {
    message: err?.message || String(err),
    code: err?.code,
    data: err?.data,
    errors: err?.errors,
    rateLimit: err?.rateLimit,
  };
  console.error(JSON.stringify({ ok: false, error: details }));
}

try {
  // 权限与凭据连通性检查
  try {
    const me = await client.v2.me();
    console.log(JSON.stringify({ connectivity: true, user: me.data }));
  } catch (e) {
    console.error(JSON.stringify({ connectivity: false }));
    await debugError(e);
    process.exit(1);
  }

  // 发帖
  const result = await client.v2.tweet(text);
  console.log(JSON.stringify({ ok: true, id: result.data?.id, data: result.data }));
} catch (e) {
  await debugError(e);
  process.exit(1);
}


