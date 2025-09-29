import { CommunityRecord } from '../types/ops.ts';

function getEnvList(name: string): string[] {
  const raw = process.env[name] || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function filterForbidden(text: string): string {
  const forbidden = getEnvList('FORBIDDEN_WORDS');
  let out = text;
  for (const w of forbidden) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, '***');
  }
  return out;
}

const disclaimer = '非投资建议 DYOR';

export function generatePostTexts(rec: CommunityRecord) {
  const hashtags = (process.env.X_HASHTAGS || '#crypto #web3 #memes')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' ');

  const base = `${rec.token_full_name} ($${rec.ticker})`;
  const punch = '上新热度，不蹭都不好意思 🐟';

  const community1 = filterForbidden(`${base} 刚上热门，社区火速集合！${hashtags} \n${disclaimer}`);
  const community2 = filterForbidden(`${base} 值得关注？观点留言区见～ ${hashtags} \n${disclaimer}`);
  const personal = filterForbidden(`发现新项目：${base} \n社区：${rec.x_community_url} \n${hashtags} \n${disclaimer}`);

  return {
    communityPosts: [community1, community2],
    personalTweet: personal,
  };
}


