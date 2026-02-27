import { TechnicalData, SandboxContext, AgentOutput, AgentOutputSchema, NewsData } from '../types';
import { LLMService } from '../services/llm';
import { buildNewsPrompt, PROMPT_VERSIONS } from '../prompts';

export const AGENT_NAME = 'newsEvents' as const;
export const PROMPT_VERSION = PROMPT_VERSIONS.newsEvents;

/**
 * News/Events Agent
 *
 * Evaluates market sentiment using:
 * - Recent news articles from Alpaca News API
 * - Web search results for current events
 * - Catalyst identification (earnings, macro events, etc.)
 */
export async function evaluate(
  data: TechnicalData,
  sandbox: SandboxContext,
  llm: LLMService,
  newsData: NewsData
): Promise<{ output: AgentOutput; rawResponse: string }> {
  const prompt = buildNewsPrompt(data, sandbox, newsData);

  const { parsed, raw } = await llm.complete(prompt);

  const validatedOutput = AgentOutputSchema.parse(parsed);

  return {
    output: validatedOutput,
    rawResponse: raw,
  };
}
