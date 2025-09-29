import { Service, type IAgentRuntime, logger, type Plugin } from '@elizaos/core';
import { z } from 'zod';
import { CrawlerService } from '../services/crawler.ts';
import { AxiomPipelineService } from '../services/axiomPipeline.ts';
import { postToCommunity } from '../services/communityPoster.ts';
import { listCommunities } from '../services/jsonDb.ts';
import { postTweet } from '../services/twitterClient.ts';
import { runAxiomOnce } from '../services/axiomPipeline.ts';

const configSchema = z.object({
  CRAWL_URLS: z.string().optional(),
  CRAWL_INTERVAL_MINUTES: z.string().optional(),
  X_POST_ON_NEW_LINK: z.string().optional(),
  DAILY_POST_INTERVAL_MINUTES: z.string().optional(),
  X_POST_ENABLED: z.string().optional(),
});

export const OpsPlugin: Plugin = {
  name: 'ops',
  description: 'X operations plugin: crawling, auto-posting, scheduling',
  priority: 0,
  config: {},
  async init(config: Record<string, string>) {
    logger.info('Initializing Ops plugin');
    const validated = await configSchema.parseAsync(config);
    for (const [k, v] of Object.entries(validated)) {
      if (typeof v !== 'undefined' && v !== null) process.env[k] = v;
    }
  },
  services: [
    CrawlerService as unknown as typeof Service,
    AxiomPipelineService as unknown as typeof Service,
  ],
  routes: [
    {
      name: 'ops_ping',
      path: '/api/ops/ping',
      type: 'GET',
      handler: async (_req: any, res: any) => {
        res.json({ ok: true, ts: Date.now() });
      },
    },
    {
      name: 'ops_tweet',
      path: '/api/ops/tweet',
      type: 'POST',
      handler: async (req: any, res: any) => {
        const text = (req.body?.text as string) || 'Onchain Koi 测试发帖 🐟';
        const id = await postTweet(text);
        res.json({ ok: true, id });
      },
    },
    {
      name: 'ops_post_community',
      path: '/api/ops/community/post',
      type: 'POST',
      handler: async (req: any, res: any) => {
        // body: { id: number, text?: string }
        const id = Number(req.body?.id);
        const text = (req.body?.text as string) || '';
        const all = await listCommunities();
        const rec = all.find((x) => x.id === id);
        if (!rec) return res.status(404).json({ ok: false, error: 'not_found' });
        const out = await postToCommunity(rec, text || `社区打卡：${rec.token_full_name} ($${rec.ticker})`);
        res.json({ ok: true, ...out });
      },
    },
    {
      name: 'ops_axiom_run_once_post',
      path: '/api/ops/axiom/run',
      type: 'POST',
      handler: async (_req: any, res: any) => {
        await runAxiomOnce();
        res.json({ ok: true });
      },
    },
    {
      name: 'ops_axiom_run_once_get',
      path: '/api/ops/axiom/run',
      type: 'GET',
      handler: async (_req: any, res: any) => {
        await runAxiomOnce();
        res.json({ ok: true });
      },
    },
  ],
};

export default OpsPlugin;


