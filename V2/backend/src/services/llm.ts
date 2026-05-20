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
  if (env.LLM_PROVIDER === 'openai' && env.OPENAI_API_KEY) {
    // Real OpenAI adapter — activates only when both LLM_PROVIDER=openai AND
    // OPENAI_API_KEY is present. Missing key silently falls back to mock so
    // the dev loop never blocks on missing credentials; a misconfigured prod
    // env will see only mock data, which is by design (loud failure on bad
    // credentials happens at first request, not module load).
    const { RealOpenAILlmService } = require('./llm.openai') as typeof import('./llm.openai');
    _instance = new RealOpenAILlmService({
      apiKey: env.OPENAI_API_KEY,
      defaultModel: env.LLM_MODEL,
      rateLimitPerMin: env.LLM_RATE_LIMIT_PER_MIN,
      temperature: env.LLM_TEMPERATURE,
    });
    return _instance;
  }
  // Smart mock is agent-aware: returns specialist-specific extras and realistic
  // latency/cost so the audit UI has varied, interesting data.
  const { SmartMockLlmService } = require('./llm.mock');
  _instance = new SmartMockLlmService() as LlmService;
  return _instance;
}

/** Test hook — reset the singleton so unit tests can swap in mocks/stubs. */
export function _resetLlmServiceForTests() {
  _instance = null;
}
