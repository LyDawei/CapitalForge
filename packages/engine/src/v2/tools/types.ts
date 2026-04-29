import { z, ZodTypeAny } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AlpacaService } from '../../services/alpaca';
import { NewsService } from '../../services/news';
import { TechnicalData, SandboxContext } from '../../types';

/**
 * Anything a tool implementation might need to do its job. Pre-built per cycle
 * so individual tools don't have to know how to construct services.
 */
export interface ToolContext {
  symbol: string;
  cycleDate: string;
  technicals: TechnicalData;
  sandbox: SandboxContext;
  alpaca: AlpacaService;
  news: NewsService | null;
  prisma: PrismaClient;
}

export interface Tool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  paramsSchema: ZodTypeAny;
  resultSchema?: ZodTypeAny;
  /**
   * Marks the deliberation-terminating tool. The head-trader loop stops as soon
   * as this is invoked; its args are returned as the final TradePlan.
   */
  terminal?: boolean;
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>;
}

export interface ToolInvocationResult {
  result: unknown;
  latencyMs: number;
  errored: boolean;
  errorMessage: string | null;
}

/**
 * One assistant request for a tool call (parsed from the LLM response).
 */
export interface ToolCallRequest {
  /** OpenAI-issued id used to thread tool-result messages back to the call. */
  id: string;
  name: string;
  args: unknown;
}

/**
 * Persisted shape — what the orchestrator writes to the ToolCall table.
 */
export interface ToolCallPersisted {
  round: number;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  latencyMs: number;
  errored: boolean;
  errorMessage: string | null;
}

/** A trivial helper for building the params schema with TS-friendly inference. */
export function defineTool<S extends ZodTypeAny, R extends ZodTypeAny>(
  cfg: {
    name: string;
    description: string;
    params: S;
    result?: R;
    terminal?: boolean;
    execute: (args: z.infer<S>, ctx: ToolContext) => Promise<z.infer<R> | unknown>;
  }
): Tool<z.infer<S>, z.infer<R>> {
  return {
    name: cfg.name,
    description: cfg.description,
    paramsSchema: cfg.params,
    resultSchema: cfg.result,
    terminal: cfg.terminal ?? false,
    execute: async (args, ctx) => cfg.execute(args, ctx) as z.infer<R>,
  };
}
