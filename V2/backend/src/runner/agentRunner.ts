import * as crypto from 'crypto';
import { prisma } from '../db';
import { getLlmService } from '../services/llm';
import { env } from '../env';

/**
 * The audit-instrumented wrapper around any single LLM call.
 *
 * Every call → one AgentRun row. The caller provides:
 * - which agent
 * - the rendered prompt
 * - the structured input payload
 * - a Zod-style validator for the output
 * - the cycle it belongs to (optional)
 *
 * Returns the AgentRun row + the parsed output (or null if validation failed).
 */
export interface RunAgentArgs {
  agentId: string;
  promptVersionId: string;
  /// Active base prompt version. The text is prepended to renderedPrompt and
  /// sent as the system prompt; the ID is recorded on the AgentRun so we can
  /// later filter "all runs against base v0.2.0".
  basePrompt?: { id: string; template: string };
  cycleId?: string;
  renderedPrompt: string;
  inputPayload: Record<string, unknown>;
  validate: (raw: string) => { ok: true; data: any } | { ok: false; error: string };
  runKind?: string;
  /// Override the LLM model for THIS call. Caller decides — typically:
  ///   - env.LLM_MODEL (head trader, premium tier)
  ///   - env.LLM_MODEL_SPECIALIST (specialists / audit / critic, cheaper tier)
  /// Defaults to env.LLM_MODEL when omitted so the legacy single-model setup
  /// keeps working without changes.
  model?: string;
}

export interface AgentRunResult {
  agentRunId: string;
  parsed: any | null;
  schemaValid: boolean;
  parseError: string | null;
  rawResponse: string;
  latencyMs: number;
}

export async function runAgent(args: RunAgentArgs): Promise<AgentRunResult> {
  const llm = getLlmService();
  // The full prompt sent to the model is base + agent. We hash and store the
  // concatenation so replay reproduces the exact input.
  const fullPrompt = args.basePrompt
    ? `${args.basePrompt.template}\n\n${args.renderedPrompt}`
    : args.renderedPrompt;
  const inputHash = crypto.createHash('sha256').update(fullPrompt).digest('hex');

  const completion = await llm.complete({
    prompt: args.renderedPrompt,
    systemPrompt: args.basePrompt?.template,
    model: args.model ?? env.LLM_MODEL,
    temperature: env.LLM_TEMPERATURE,
  });

  let parsed: any = null;
  let schemaValid = false;
  let parseError: string | null = null;

  try {
    const result = args.validate(completion.text);
    if (result.ok) {
      parsed = result.data;
      schemaValid = true;
    } else {
      parseError = result.error;
    }
  } catch (err: any) {
    parseError = err.message ?? 'Unknown parse error';
  }

  const run = await prisma.agentRun.create({
    data: {
      agentId: args.agentId,
      promptVersionId: args.promptVersionId,
      basePromptVersionId: args.basePrompt?.id ?? null,
      cycleId: args.cycleId ?? null,
      inputHash,
      renderedPrompt: fullPrompt,
      inputPayload: args.inputPayload as any,
      provider: completion.provider,
      modelName: completion.modelName,
      temperature: env.LLM_TEMPERATURE,
      rawResponse: completion.text,
      parsedOutput: parsed,
      schemaValid,
      parseError,
      latencyMs: completion.latencyMs,
      tokensIn: completion.tokensIn ?? null,
      tokensOut: completion.tokensOut ?? null,
      costUsd: completion.costUsd ?? null,
      runKind: args.runKind ?? 'primary',
    },
  });

  return {
    agentRunId: run.id,
    parsed,
    schemaValid,
    parseError,
    rawResponse: completion.text,
    latencyMs: completion.latencyMs,
  };
}
