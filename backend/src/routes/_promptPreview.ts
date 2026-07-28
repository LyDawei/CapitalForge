/**
 * Preview-before-save for prompts.
 *
 * Pre-flight check that mirrors what the runner does on a real cycle:
 *   1. Concatenate directive + contract.
 *   2. Send to the smart-mock LLM with the same synthetic technicals payload
 *      that a real cycle injects.
 *   3. Validate the response against the agent's Zod schema.
 *
 * Returns a structured result the route handlers translate into either a
 * 201 success (allowing the version to persist) or a 400 with the parse error.
 *
 * This is Phase 1 of the prompt-output-contract work in TODO.md — catches
 * accidental contract breaks (renamed fields, dropped JSON-only instruction)
 * before they poison a real cycle.
 */
import { getLlmService } from '../services/llm';
import { validateAgentOutput, outputContractFor, hasContract } from '../schemas/agent-outputs';
import type { Technicals } from '../runner/technicals';

export interface PreviewResult {
  ok: boolean;
  parseError?: string;
  rendered: string;
  raw: string;
  parsed?: unknown;
  latencyMs: number;
}

const SYNTHETIC_TECHNICALS: Technicals = {
  symbol: 'TEST',
  date: '2026-05-18',
  close: 175.42,
  rsi: 58.3,
  sma20: 172.18,
  sma50: 168.93,
  sma200: 155.21,
  macdHistogram: 0.42,
  macdLine: 1.21,
  signalLine: 0.79,
  atr14: 4.32,
  atrPct: 0.0246,
  volume: 42_100_000,
  avgVolume: 38_500_000,
};

function renderTechnicals(tech: Technicals): string {
  const sma200Line = tech.sma200 !== null ? `$${tech.sma200.toFixed(2)}` : 'INSUFFICIENT_HISTORY';
  return `--- TECHNICALS ---\nSymbol: ${tech.symbol}\nDate: ${tech.date}\nClose: $${tech.close.toFixed(2)}\nRSI(14): ${tech.rsi.toFixed(2)}\nSMA(20): $${tech.sma20.toFixed(2)}\nSMA(50): $${tech.sma50.toFixed(2)}\nSMA(200): ${sma200Line}\nMACD Histogram: ${tech.macdHistogram.toFixed(4)}\nATR(14): $${tech.atr14.toFixed(2)} (${(tech.atrPct * 100).toFixed(2)}% of close)\nVolume: ${tech.volume.toLocaleString()} (30d avg: ${tech.avgVolume.toLocaleString()})`;
}

export interface PreviewArgs {
  agentName: string;
  directiveTemplate: string;
  /// Override the contract used for the preview. Defaults to
  /// `outputContractFor(agentName)`. Useful when an external caller already
  /// knows the contract (e.g., the route already computed it).
  outputContract?: string;
  /// Active base prompt template, if any. Sent as the system prompt to mirror
  /// what the runner does. Pass undefined when previewing the base prompt
  /// itself — the route handler is responsible for ordering.
  systemPrompt?: string;
}

export async function previewPromptVersion(args: PreviewArgs): Promise<PreviewResult> {
  if (!hasContract(args.agentName)) {
    return {
      ok: false,
      parseError: `Unknown agent: ${args.agentName}`,
      rendered: '',
      raw: '',
      latencyMs: 0,
    };
  }

  const contract = args.outputContract ?? outputContractFor(args.agentName);
  const rendered = `${args.directiveTemplate}\n\n${contract}\n\n${renderTechnicals(SYNTHETIC_TECHNICALS)}`;

  const llm = getLlmService();
  const completion = await llm.complete({
    prompt: rendered,
    systemPrompt: args.systemPrompt,
  });

  const validation = validateAgentOutput(args.agentName, completion.text);
  if (!validation.ok) {
    return {
      ok: false,
      parseError: validation.error,
      rendered,
      raw: completion.text,
      latencyMs: completion.latencyMs,
    };
  }

  return {
    ok: true,
    rendered,
    raw: completion.text,
    parsed: validation.data,
    latencyMs: completion.latencyMs,
  };
}
