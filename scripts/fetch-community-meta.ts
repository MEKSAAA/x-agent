import 'dotenv/config';
import { listCommunities } from '../src/services/jsonDb.ts';
import { fetchCommunityMeta } from '../src/services/communityPoster.ts';

async function main() {
  const limit = Number(process.env.LIMIT || '5');
  const all = await listCommunities();
  const targets = all.filter(c => !c.community_banner_path || !c.community_name).slice(0, Math.max(1, limit));
  if (!targets.length) {
    console.log(JSON.stringify({ ok: true, message: 'No targets needing meta.' }));
    return;
  }
  for (const rec of targets) {
    try {
      await fetchCommunityMeta(rec);
      console.log(JSON.stringify({ ok: true, id: rec.id }));
    } catch (e) {
      console.error(JSON.stringify({ ok: false, id: rec.id, error: String(e) }));
    }
  }
}

main();
