import { TechnicalData, SandboxContext, AgentOutput, AgentOutputSchema } from '../types';
import { LLMService } from '../services/llm';
import { buildPrompt, PROMPT_VERSIONS } from '../prompts';

export const AGENT_NAME = 'momentum' as const;
export const PROMPT_VERSION = PROMPT_VERSIONS.momentum;

/**
 * Momentum Agent
 *
 * Evaluates trend strength using:
 * - RSI position (>70 overbought, <30 oversold)
 * - Price vs SMA20/SMA50
 * - Volume vs average
 */
export async function evaluate(
  data: TechnicalData,
  sandbox: SandboxContext,
  llm: LLMService
): Promise<{ output: AgentOutput; rawResponse: string }> {
  const prompt = buildPrompt('momentum', data, sandbox);

  const { parsed, raw } = await llm.complete(prompt);

  // Validate output with zod (already done in LLM service, but double-check)
  const validatedOutput = AgentOutputSchema.parse(parsed);

  return {
    output: validatedOutput,
    rawResponse: raw,
  };
}
