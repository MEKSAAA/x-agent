import { ModelType, type IAgentRuntime, logger } from '@elizaos/core';
import { CommunityRecord } from '../types/ops.ts';

// 中文：读取逗号分隔的列表环境变量
function getList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// 中文：敏感词替换
function filterForbidden(text: string): string {
  const forbidden = getList('FORBIDDEN_WORDS');
  let out = text;
  for (const w of forbidden) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, '***');
  }
  return out;
}

// 中文：保证至少包含 1 个品牌标签
function ensureBrandTags(text: string): string {
  const baseTags = ['#CommiFam', '#RealImpact', '#MemeDrop'];
  const hasAny = baseTags.some((t) => text.includes(t));
  if (hasAny) return text;
  const pick = baseTags[0];
  if (text.length + pick.length + 1 <= 240) return `${text} ${pick}`;
  return text;
}

// 中文：检测是否满足长度/标签约束
function isAcceptableTweet(text: string): boolean {
  const lenOk = text.length <= 240 && text.length >= 20; // 过短也不理想
  const hasTag = /#[A-Za-z0-9_]+/.test(text);
  return lenOk && hasTag;
}

// 中文：生成 CommiEcho 风格的个人时间线文案；失败时回退到模板
export async function generatePersonalTweet(runtime: IAgentRuntime, rec: CommunityRecord): Promise<string> {
  const link = rec.x_community_url || '';
  const name = rec.token_full_name || '';
  const ticker = rec.ticker ? `(${rec.ticker})` : '';
  const betaLink = (process.env.COMMI_BETA_LINK || '').trim();
  const campaignName = (process.env.COMMI_CAMPAIGN_NAME || 'campaign').trim();
  const campaignTag = (process.env.COMMI_CAMPAIGN_TAG || '#CommiFam').trim();
  const communityName = (rec.community_name || '').trim();

  // 优先使用外部 hashtags 配置
  const extTags = getList('X_HASHTAGS');
  const tagHint = extTags.length ? extTags.slice(0, 2).join(' ') : '#CommiFam #RealImpact';

  // 英文设定 + 约束
  // 中文：基于社区与 ID 选择不同风格提示，保证跨社区的多样性
  const styleCues = [
    'Hook: vibe check with playful energy',
    'Hook: alpha whisper, early power tone',
    'Hook: meme drop with a cheeky twist',
    'Hook: invite fam to pull up and tag friends',
    'Hook: curiosity ping + question CTA',
  ];
  const styleCue = styleCues[Math.abs((rec.id || 0)) % styleCues.length];

  const prompt = [
    'You are CommiEcho — the playful and sharp-eyed meme amplifier for the Commi fam.',
    'Write ONE tweet for X in English or Chinese tone depending on the input context.',
    'Constraints:',
    '- ≤240 characters; punchy; human; witty; meme vibe; inclusive;',
    '- Include 1–2 relevant hashtags like #CommiFam, #RealImpact, #MemeDrop;',
    '- Add a light CTA (ask a question, invite replies, or subtle “pull up”).',
    '- Avoid corporate tone and over-technical phrasing; no promises or financial advice;',
    '- Output ONLY the tweet text.',
    '',
    `Context: token/project name: ${name} ${ticker}`,
    `Community: ${link}`,
    `Community Name (use it explicitly in the text if reasonable): ${communityName || '(unknown)'}`,
    `Invite fam to create/participate in ${campaignName} on commi; include Beta link if space allows: ${betaLink || '(no beta link)'}`,
    `Suggested tags: ${tagHint} ${campaignTag}`,
    styleCue,
  ].join('\n');

  let text = '';
  try {
    const out = await runtime.useModel?.(ModelType.TEXT_LARGE, {
      prompt,
      temperature: 0.6,
      maxTokens: 220,
    });
    if (typeof out === 'string') text = out.trim();
  } catch (e) {
    logger.error({ e }, 'generatePersonalTweet model error');
  }

  // 简单重写策略：最多两次
  for (let i = 0; i < 2 && (!text || !isAcceptableTweet(text)); i += 1) {
    try {
      const fixPrompt = [
        'Revise the following tweet to satisfy constraints. Keep it short and add 1–2 relevant hashtags.',
        'Constraints: ≤240 chars; meme vibe; human; include at least one of #CommiFam, #RealImpact, #MemeDrop; output only the tweet text.',
        `Tweet: ${text || '(empty)'}`,
      ].join('\n');
      const out2 = await runtime.useModel?.(ModelType.TEXT_SMALL, {
        prompt: fixPrompt,
        temperature: 0.5,
        maxTokens: 200,
      });
      if (typeof out2 === 'string') text = out2.trim();
    } catch (e) {
      logger.warn({ e }, 'generatePersonalTweet rewrite warn');
    }
  }

  // 最终清理与兜底
  if (!text) {
    text = `Vibe check: ${name} ${ticker} — pull up and drop takes! ${link} ${tagHint} ${campaignTag}`;
  }
  text = filterForbidden(text);
  text = ensureBrandTags(text);
  // 若模型未显式包含社区名且长度允许，补上一处
  if (communityName && !new RegExp(communityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
    if (text.length + communityName.length + 3 <= 240) {
      text = `${text} — ${communityName}`;
    }
  }
  if (betaLink && !text.includes(betaLink) && text.length + betaLink.length + 1 <= 240) {
    text = `${text} ${betaLink}`;
  }
  if (text.length > 240) text = text.slice(0, 239);
  return text;
}

// 中文：生成社区帖（更直接地号召到 commi 发起/参与 campaign，带 BetaLink）
export async function generateCommunityPost(runtime: IAgentRuntime, rec: CommunityRecord): Promise<string> {
  const link = rec.x_community_url || '';
  const name = rec.token_full_name || '';
  const ticker = rec.ticker ? `(${rec.ticker})` : '';
  const betaLink = (process.env.COMMI_BETA_LINK || '').trim();
  const campaignName = (process.env.COMMI_CAMPAIGN_NAME || 'campaign').trim();
  const campaignTag = (process.env.COMMI_CAMPAIGN_TAG || '#CommiFam').trim();
  const communityName = (rec.community_name || '').trim();
  const extTags = getList('X_HASHTAGS');
  const tagHint = extTags.length ? extTags.slice(0, 2).join(' ') : '#CommiFam #RealImpact';

  const prompt = [
    'You are CommiEcho. Write ONE short community post for X Communities with meme vibe.',
    'Constraints: ≤220 chars; human; punchy; explicitly reference the community name if available; invite to create/participate in a commi campaign; include 1–2 tags; output only text.',
    `Context: token/project: ${name} ${ticker}`,
    `Community: ${link}`,
    `Community Name: ${communityName || '(unknown)'}`,
    `Campaign: ${campaignName}`,
    `Beta link: ${betaLink || '(no beta link)'}`,
    `Tags: ${tagHint} ${campaignTag}`,
  ].join('\n');

  let text = '';
  try {
    const out = await runtime.useModel?.(ModelType.TEXT_LARGE, {
      prompt,
      temperature: 0.6,
      maxTokens: 200,
    });
    if (typeof out === 'string') text = out.trim();
  } catch (e) {
    logger.error({ e }, 'generateCommunityPost model error');
  }

  // 简单重写
  for (let i = 0; i < 2 && (!text || !isAcceptableTweet(text)); i += 1) {
    try {
      const fixPrompt = [
        'Revise the post to fit constraints (≤220 chars; include tag; human; meme vibe). Output only text.',
        `Post: ${text || '(empty)'}`,
      ].join('\n');
      const out2 = await runtime.useModel?.(ModelType.TEXT_SMALL, {
        prompt: fixPrompt,
        temperature: 0.5,
        maxTokens: 180,
      });
      if (typeof out2 === 'string') text = out2.trim();
    } catch (e) {
      logger.warn({ e }, 'generateCommunityPost rewrite warn');
    }
  }

  if (!text) {
    const baseName = communityName || name || 'the community';
    text = `Fam roll call: ${baseName} — pull up to ${campaignName}! ${betaLink || link} ${campaignTag}`;
  }
  text = filterForbidden(text);
  text = ensureBrandTags(text);
  if (communityName && !new RegExp(communityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
    if (text.length + communityName.length + 3 <= 220) {
      text = `${text} — ${communityName}`;
    }
  }
  if (betaLink && !text.includes(betaLink) && text.length + betaLink.length + 1 <= 220) {
    text = `${text} ${betaLink}`;
  }
  if (text.length > 220) text = text.slice(0, 219);
  return text;
}
