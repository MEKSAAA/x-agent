import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import starterPlugin from './plugin.ts';
import { OpsPlugin } from './plugins/ops.ts';
import xAgentPlugin from './plugins/xAgent.ts';
import { character } from './character.ts';

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing character');
  logger.info({ name: character.name }, 'Name:');
  // 让服务层（如 AxiomPipeline）在非事件上下文也能访问到模型能力
  try {
    (globalThis as any).runtime = runtime;
  } catch {}
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  plugins: [starterPlugin, OpsPlugin, xAgentPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from './character.ts';

export default project;
