import { env } from '../env';

/**
 * Provider-agnostic LLM completion result. The audit fields (latency, tokens,
 * cost) are populated by the adapter, never inferred downstream — the agent
 * runner writes them straight into AgentRun.
 */
export interface LlmCompletion {
  text: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  provider: 'openai' | 'anthropic' | 'mock';
  modelName: string;
}

export interface LlmService {
  complete(args: {
    prompt: string;
    model?: string;
    temperature?: number;
    systemPrompt?: string;
  }): Promise<LlmCompletion>;
}

let _instance: LlmService | null = null;

export function getLlmService(): LlmService {
  if (_instance) return _instance;
  // Smart mock is agent-aware: returns specialist-specific extras and realistic
  // latency/cost so the audit UI has varied, interesting data.
  // Real adapters (openai/anthropic) will live in separate files; for now they
  // fall back to smart mock so the dev loop never blocks on missing API keys.
  const { SmartMockLlmService } = require('./llm.mock');
  _instance = new SmartMockLlmService() as LlmService;
  return _instance;
}
