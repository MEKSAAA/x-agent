import 'dotenv/config';
import { postTweet } from '../src/services/twitterClient.ts';

async function main() {
  const text = process.argv.slice(2).join(' ') || 'Onchain Koi 一次性验证 🐟（非投资建议）';
  const id = await postTweet(text);
  if (id) {
    console.log(JSON.stringify({ ok: true, id }));
  } else {
    console.error(JSON.stringify({ ok: false }));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


