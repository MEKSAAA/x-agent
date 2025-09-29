import type { Plugin } from '@elizaos/core';
import { logger, Service, type IAgentRuntime, ModelType, type GenerateTextParams, type TextEmbeddingParams } from '@elizaos/core';
import { MentionReplyService } from '../services/mentionReply.ts';
import { ImageCardService } from '../services/imageCard.ts';

// 中文：按环境变量动态构造模型映射，允许无 Embedding 或无自定义网关时不注册对应模型
const models: Plugin['models'] = {};

// 仅当提供了自定义网关（或 OpenRouter）密钥时，才注册文本模型，避免覆盖官方 OpenAI 插件
if (process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.LLM_API_BASE) {
  models[ModelType.TEXT_LARGE] = async (_runtime: IAgentRuntime, params: GenerateTextParams) => {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('缺少 LLM_API_KEY（或 OPENROUTER_API_KEY），无法调用文本大模型');
    }
    const base = (process.env.LLM_API_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const model = process.env.LLM_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const temperature = params.temperature ?? 0.6;
    const maxTokens = params.maxTokens ?? 512;
    const prompt = params.prompt ?? '';
    const body = {
      model,
      messages: [
        { role: 'system', content: 'You are CommiEcho. Stay playful, witty, inclusive. Keep outputs short and punchy.' },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
    } as any;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM chat HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return typeof content === 'string' ? content : JSON.stringify(content);
  };

  models[ModelType.TEXT_SMALL] = async (_runtime: IAgentRuntime, params: GenerateTextParams) => {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('缺少 LLM_API_KEY（或 OPENROUTER_API_KEY），无法调用文本小模型');
    }
    const base = (process.env.LLM_API_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const model = process.env.LLM_MODEL_SMALL || process.env.OPENROUTER_MODEL_SMALL || process.env.LLM_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const temperature = params.temperature ?? 0.3;
    const maxTokens = Math.min(params.maxTokens ?? 256, 512);
    const prompt = params.prompt ?? '';
    const body = {
      model,
      messages: [
        { role: 'system', content: 'You are concise and helpful.' },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
    } as any;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM chat HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return typeof content === 'string' ? content : JSON.stringify(content);
  };
}

// 中文：仅当明确提供嵌入模型时，才注册 TEXT_EMBEDDING，避免无向量模型时崩溃
if ((process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.LLM_API_BASE) && (process.env.LLM_EMBED_MODEL || process.env.OPENROUTER_EMBED_MODEL)) {
  // @ts-ignore - 动态附加
  models[ModelType.TEXT_EMBEDDING] = async (_runtime: IAgentRuntime, params: TextEmbeddingParams | string | null) => {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('缺少 LLM_API_KEY（或 OPENROUTER_API_KEY），无法调用向量模型');
    }
    const base = (process.env.LLM_API_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const model = process.env.LLM_EMBED_MODEL || process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
    const inputText = typeof params === 'string' ? params : (params as any)?.text || '';
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: inputText }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM embeddings HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const vector: number[] | undefined = data?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) throw new Error('Invalid embedding response');
    return vector;
  };
}

const plugin: Plugin = {
  name: 'xAgent',
  description: 'X Agent runtime plugin: scheduling, mention replies, and image cards.',
  priority: 0,
  async init(_config: Record<string, string>) {
    logger.info('xAgent plugin initialized');
  },
  models,
  // 中文：仅注册与互动/配图相关的服务，避免与 OpsPlugin 的调度/Axiom 冲突
  services: [MentionReplyService as unknown as typeof Service, ImageCardService as unknown as typeof Service],
};

export default plugin;
