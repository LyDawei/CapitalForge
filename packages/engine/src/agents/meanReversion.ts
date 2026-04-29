import { TechnicalData, SandboxContext, AgentOutput, AgentOutputSchema } from '../types';
import { LLMService } from '../services/llm';
import { buildPrompt, PROMPT_VERSIONS } from '../prompts';

export const AGENT_NAME = 'meanReversion' as const;
export const PROMPT_VERSION = PROMPT_VERSIONS.meanReversion;

/**
 * Mean Reversion Agent
 *
 * Evaluates reversion potential using:
 * - RSI extremes
 * - Price deviation from SMAs
 * - Overextension signals
 */
export async function evaluate(
  data: TechnicalData,
  sandbox: SandboxContext,
  llm: LLMService
): Promise<{ output: AgentOutput; rawResponse: string }> {
  const prompt = buildPrompt('meanReversion', data, sandbox);

  const { parsed, raw } = await llm.complete(prompt);

  // Validate output with zod (already done in LLM service, but double-check)
  const validatedOutput = AgentOutputSchema.parse(parsed);

  return {
    output: validatedOutput,
    rawResponse: raw,
  };
}
