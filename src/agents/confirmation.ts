import { TechnicalData, SandboxContext, AgentOutput, AgentOutputSchema } from '../types';
import { LLMService } from '../services/llm';
import { buildPrompt, PROMPT_VERSIONS } from '../prompts';

export const AGENT_NAME = 'confirmation' as const;
export const PROMPT_VERSION = PROMPT_VERSIONS.confirmation;

/**
 * Confirmation Agent
 *
 * Cross-validates signals using:
 * - MACD histogram direction
 * - SMA crossover state
 * - Volume confirmation
 */
export async function evaluate(
  data: TechnicalData,
  sandbox: SandboxContext,
  llm: LLMService
): Promise<{ output: AgentOutput; rawResponse: string }> {
  const prompt = buildPrompt('confirmation', data, sandbox);

  const { parsed, raw } = await llm.complete(prompt);

  // Validate output with zod (already done in LLM service, but double-check)
  const validatedOutput = AgentOutputSchema.parse(parsed);

  return {
    output: validatedOutput,
    rawResponse: raw,
  };
}
