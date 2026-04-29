import { TradePlanSchema } from '@capitalforge/shared';
import type { TradePlan } from '@capitalforge/shared';
import {
  LLMService,
  ChatMessage,
  extractJson,
} from '../../services/llm';
import {
  buildHeadTraderPrompt,
  HEAD_TRADER_PROMPT_VERSION,
  HeadTraderPromptContext,
} from '../prompts/headTrader';
import { ToolRegistry, ToolContext, ToolCallPersisted } from '../tools';

export { HEAD_TRADER_PROMPT_VERSION };

const HEAD_TRADER_SYSTEM_PROMPT = `You are the head trader on a swing-trading desk.
You have specialist analyses, tools to verify or extend them, and a single terminal decision to make.

Workflow:
  1. Read the specialist reports and the META block in the user message.
  2. Optionally call tools to verify hunches or fetch missing context (atr stop, market regime, sector RS, news, position history, correlations, earnings calendar).
  3. When confident, call submit_decision exactly once. That ends deliberation.

Rules:
  - Always call submit_decision when finished — never reply with prose only.
  - Respect the kill criteria from the user prompt (catalysts, regime, exhaustion, drawdown).
  - Risk is capped per the META.config.maxRiskPctPerTrade.`;

export interface DeliberateResult {
  plan: TradePlan;
  rounds: number;
  totalLatencyMs: number;
  totalTokens: number | null;
  rawResponse: string;
  modelName: string;
  promptVersion: string;
  prompt: string;
  toolCalls: ToolCallPersisted[];
}

export interface DeliberateOptions {
  maxRounds?: number;
}

/**
 * M4 head-trader deliberation. Multi-round loop:
 *
 *   loop until submit_decision OR maxRounds:
 *     llm.chatWithTools(messages, tools)
 *     for each tool call:
 *       if submit_decision → final plan, end.
 *       else → execute, append tool result message.
 *     append assistant message (with its tool calls).
 *
 * On timeout: synthesize a defensive HOLD plan so the cycle still produces a row.
 */
export async function deliberate(
  ctx: HeadTraderPromptContext,
  llm: LLMService,
  modelName: string,
  tools?: ToolRegistry,
  toolCtx?: ToolContext,
  options: DeliberateOptions = {}
): Promise<DeliberateResult> {
  const maxRounds = options.maxRounds ?? 6;

  // No tool registry? Fall back to single-shot completion path (M3 behavior).
  if (!tools || !toolCtx) {
    return deliberateSingleShot(ctx, llm, modelName);
  }

  const userPrompt = buildHeadTraderPrompt(ctx);
  const messages: ChatMessage[] = [
    { role: 'system', content: HEAD_TRADER_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
  const toolDescriptors = tools.toOpenAITools();
  const reasoningTrace: Array<{ round: number; thought: string; toolUsed: string | null }> = [];
  const toolCalls: ToolCallPersisted[] = [];
  const start = Date.now();
  let totalTokens: number | null = null;
  let rawTrace = '';

  let final: TradePlan | null = null;
  let rounds = 0;

  while (rounds < maxRounds && !final) {
    rounds++;
    const resp = await llm.chatWithTools({ messages, tools: toolDescriptors });
    rawTrace += `\n--- round ${rounds} ---\n${resp.raw}`;
    if (resp.totalTokens) totalTokens = (totalTokens ?? 0) + resp.totalTokens;

    // Record the assistant's narrative thought for this round.
    if (resp.message.content) {
      reasoningTrace.push({
        round: rounds,
        thought: resp.message.content,
        toolUsed: resp.message.toolCalls[0]?.name ?? null,
      });
    }

    // Append the assistant message with its tool calls so subsequent rounds see it.
    messages.push({
      role: 'assistant',
      content: resp.message.content,
      toolCalls: resp.message.toolCalls,
    });

    // Edge case: no tool call AND no submit. Nudge once, then exit.
    if (resp.message.toolCalls.length === 0) {
      messages.push({
        role: 'user',
        content:
          'You did not call a tool. Please call submit_decision now if you are ready, or use a tool to verify your thesis.',
      });
      continue;
    }

    for (const tc of resp.message.toolCalls) {
      if (tc.name === 'submit_decision') {
        const candidate = TradePlanSchema.safeParse({
          ...(tc.args as Record<string, unknown>),
          reasoningTrace, // synthesized from the loop
        });
        if (candidate.success) {
          final = candidate.data;
          // Don't append a tool-result message after the terminal call.
        } else {
          // Tell the LLM to fix the schema mismatch and try again.
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: JSON.stringify({
              error: 'TradePlan validation failed',
              details: candidate.error.message,
            }),
          });
        }
        continue;
      }

      // Non-terminal tool: execute and append the result.
      const inv = await tools.invoke(tc.name, tc.args, toolCtx);
      toolCalls.push({
        round: rounds,
        toolName: tc.name,
        args: (tc.args as Record<string, unknown>) ?? {},
        result: inv.result,
        latencyMs: inv.latencyMs,
        errored: inv.errored,
        errorMessage: inv.errorMessage,
      });
      messages.push({
        role: 'tool',
        toolCallId: tc.id,
        content: JSON.stringify(inv.errored ? { error: inv.errorMessage } : inv.result),
      });
    }
  }

  if (!final) {
    final = forceHoldFallback(ctx, reasoningTrace, 'deliberation_timeout');
  }

  return {
    plan: final,
    rounds,
    totalLatencyMs: Date.now() - start,
    totalTokens,
    rawResponse: rawTrace,
    modelName,
    promptVersion: HEAD_TRADER_PROMPT_VERSION,
    prompt: userPrompt,
    toolCalls,
  };
}

/** M3 single-shot path. Kept for tests and as a fallback when no tool registry is wired. */
async function deliberateSingleShot(
  ctx: HeadTraderPromptContext,
  llm: LLMService,
  modelName: string
): Promise<DeliberateResult> {
  const prompt = buildHeadTraderPrompt(ctx);
  const start = Date.now();
  const raw = await llm.completeRaw(prompt);
  const totalLatencyMs = Date.now() - start;
  const parsed = extractJson(raw);
  const result = TradePlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Head trader output failed TradePlanSchema validation: ${result.error.message}\nRaw: ${raw}`
    );
  }
  return {
    plan: result.data,
    rounds: 1,
    totalLatencyMs,
    totalTokens: null,
    rawResponse: raw,
    modelName,
    promptVersion: HEAD_TRADER_PROMPT_VERSION,
    prompt,
    toolCalls: [],
  };
}

function forceHoldFallback(
  ctx: HeadTraderPromptContext,
  reasoningTrace: Array<{ round: number; thought: string; toolUsed: string | null }>,
  reason: string
): TradePlan {
  return {
    action: 'HOLD',
    conviction: 0,
    setupName: null,
    entry: ctx.technicals.close,
    stop: null,
    target1: null,
    target2: null,
    riskPctOfEquity: 0,
    timeStop: null,
    invalidationCriteria: [],
    reasoningTrace: [
      ...reasoningTrace,
      {
        round: reasoningTrace.length + 1,
        thought: `Forced HOLD: ${reason}.`,
        toolUsed: null,
      },
    ],
  };
}
