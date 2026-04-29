import { SpecialistOutputSchema } from '@capitalforge/shared';
import type {
  SpecialistName,
  SpecialistOutput,
  TechnicalData,
  SandboxContext,
} from '@capitalforge/shared';
import { LLMService, extractJson } from '../../services/llm';

export interface SpecialistContext {
  symbol: string;
  technicals: TechnicalData;
  sandbox: SandboxContext;
}

export interface Specialist {
  name: SpecialistName;
  promptVersion: string;
  buildPrompt(ctx: SpecialistContext): string;
  /** Optional fallback that returns a baseline output if the LLM call fails. */
  fallback?: (ctx: SpecialistContext) => SpecialistOutput;
}

export interface SpecialistRunResult {
  name: SpecialistName;
  output: SpecialistOutput;
  promptVersion: string;
  rawResponse: string;
}

export async function runSpecialist(
  specialist: Specialist,
  ctx: SpecialistContext,
  llm: LLMService
): Promise<SpecialistRunResult> {
  const prompt = specialist.buildPrompt(ctx);
  const raw = await llm.completeRaw(prompt);
  const parsed = parseSpecialistOutput(raw, specialist.name);
  return {
    name: specialist.name,
    output: parsed,
    promptVersion: specialist.promptVersion,
    rawResponse: raw,
  };
}

function parseSpecialistOutput(raw: string, name: SpecialistName): SpecialistOutput {
  const parsed = extractJson(raw);
  const result = SpecialistOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Specialist ${name} output failed validation: ${result.error.message}\nRaw: ${raw}`
    );
  }
  return result.data;
}

// Common prompt formatting helpers used by every specialist.
export function formatPositionSummary(sandbox: SandboxContext): string {
  if (sandbox.positionQty === 0) return 'No current position (flat)';
  return `Holding ${sandbox.positionQty} shares of ${sandbox.positionSymbol} at avg price $${sandbox.positionAvgPrice?.toFixed(2)}`;
}

export function formatTechnicalsBlock(t: TechnicalData): string {
  return [
    `- Date: ${t.date}`,
    `- Symbol: ${t.symbol}`,
    `- Close: $${t.close.toFixed(2)}`,
    `- RSI(14): ${t.rsi.toFixed(2)}`,
    `- SMA(20): $${t.sma20.toFixed(2)}`,
    `- SMA(50): $${t.sma50.toFixed(2)}`,
    `- MACD Histogram: ${t.macdHistogram.toFixed(4)}`,
    `- Volume: ${t.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })} (30-day avg: ${t.avgVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })})`,
  ].join('\n');
}

export function formatSandboxBlock(sandbox: SandboxContext): string {
  return [
    `- Allocated: $${sandbox.allocatedCapital.toFixed(2)}`,
    `- Equity: $${sandbox.currentEquity.toFixed(2)}`,
    `- Drawdown: ${(sandbox.drawdownPct * 100).toFixed(1)}%`,
  ].join('\n');
}

export const SPECIALIST_OUTPUT_INSTRUCTIONS = `Respond with JSON only, matching this shape:
{
  "bullishScore": <number from -1 (very bearish) to +1 (very bullish)>,
  "confidence": <number from 0 (no confidence) to 1 (high confidence)>,
  "rationale": ["reason 1", "reason 2", ...],   // 2 to 6 entries
  "flags": ["overbought" | "oversold" | "breakout" | "breakdown" | "pullback" | "base" | "gap" | "volume_surge" | "volume_dry" | "earnings_window" | "macro_event" | "rsi_divergence", ...],
  "keyLevels": { "support": <number|null>, "resistance": <number|null> },  // optional
  "extras": { ... }    // optional, specialist-specific structured fields described above
}`;
