import {
  LLMService,
  ChatMessage,
  ChatWithToolsResult,
  ToolDescriptor,
  ToolCallRequest,
} from './llm';
import { AgentOutput } from '../types';
import type { SpecialistName, SpecialistOutput } from '@capitalforge/shared';

// Deterministic mock LLM for testing.
// Produces consistent outputs based on the prompt's embedded technicals + specialist marker.

export class MockLLMService implements LLMService {
  async complete(prompt: string): Promise<{ parsed: AgentOutput; raw: string }> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const output = this.generateDeterministicOutput(prompt);
    const raw = JSON.stringify(output, null, 2);
    return { parsed: output, raw };
  }

  async completeRaw(prompt: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (prompt.includes('[HEAD_TRADER]')) {
      return JSON.stringify(generateHeadTraderPlan(prompt), null, 2);
    }
    const specialist = detectSpecialist(prompt);
    if (specialist) {
      return JSON.stringify(generateSpecialistOutput(specialist, prompt), null, 2);
    }
    // Fall back to V1 AgentOutput (e.g., V1 agents calling completeRaw won't happen,
    // but keep behavior coherent if a caller does).
    return JSON.stringify(this.generateDeterministicOutput(prompt), null, 2);
  }

  private generateDeterministicOutput(prompt: string): AgentOutput {
    const rsi = extractNumber(prompt, /RSI\(14\):\s*([\d.]+)/);
    const sma20 = extractNumber(prompt, /SMA\(20\):\s*\$?([\d.]+)/);
    const sma50 = extractNumber(prompt, /SMA\(50\):\s*\$?([\d.]+)/);
    const close = extractNumber(prompt, /Close:\s*\$?([\d.]+)/);
    const macdHistogram = extractNumber(prompt, /MACD Histogram:\s*([-\d.]+)/);

    const agentType = detectV1AgentType(prompt);
    return calculateV1Score(agentType, rsi, sma20, sma50, close, macdHistogram);
  }

  /**
   * Mock tool-calling. Scripted by inspecting the conversation:
   *   - Round 1: call get_market_regime + get_atr_stop_suggestion (gather context).
   *   - Subsequent rounds: see prior tool results, then call submit_decision with
   *     a TradePlan derived from the META block + observed tool outputs.
   * Stays deterministic across runs because every input is in the message history.
   */
  async chatWithTools(input: {
    messages: ChatMessage[];
    tools: ToolDescriptor[];
  }): Promise<ChatWithToolsResult> {
    await new Promise((r) => setTimeout(r, 10));
    return scriptHeadTraderToolRound(input.messages, input.tools);
  }
}

export function createMockLLMService(): LLMService {
  return new MockLLMService();
}

// ============================================================================
// Tool-calling script — deterministic mock for the head-trader loop
// ============================================================================

function scriptHeadTraderToolRound(
  messages: ChatMessage[],
  tools: ToolDescriptor[]
): ChatWithToolsResult {
  const toolNames = new Set(tools.map((t) => t.function.name));
  // Find the user message containing the head-trader META so we can derive the plan.
  const promptMsg = messages.find(
    (m) => m.role === 'user' && (m.content ?? '').includes('[HEAD_TRADER]')
  );
  const prompt = promptMsg?.content ?? '';

  // Count tool calls already issued so we can advance the script.
  const issued = new Set(
    messages
      .filter((m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0)
      .flatMap((m) => (m.toolCalls ?? []).map((tc) => tc.name))
  );

  // Round 1 — gather context.
  if (!issued.has('get_market_regime') && toolNames.has('get_market_regime')) {
    return assistantToolCalls(
      'Pulling market regime and ATR stop before deciding.',
      [
        toolCall('get_market_regime', {}),
        ...(toolNames.has('get_atr_stop_suggestion')
          ? [
              toolCall('get_atr_stop_suggestion', {
                entry: extractNumber(prompt, /Close:\s*\$([\d.]+)/) || 100,
                multiplier: 1.5,
              }),
            ]
          : []),
      ]
    );
  }

  // Round 2+ — submit decision based on prompt META.
  const meta = extractMeta(prompt);
  const plan = generateHeadTraderPlan(prompt) as Record<string, unknown>;
  // submit_decision schema doesn't include reasoningTrace — the orchestrator builds that.
  delete plan.reasoningTrace;
  if (toolNames.has('submit_decision')) {
    return assistantToolCalls(
      `Decision: ${plan.action} (conviction ${(plan.conviction as number).toFixed(2)}; weighted ${meta.weightedScore.toFixed(2)}).`,
      [toolCall('submit_decision', plan)]
    );
  }
  // Shouldn't happen, but never hang the loop.
  return { message: { role: 'assistant', content: 'unable to submit', toolCalls: [] }, raw: '{}' };
}

let toolCallSeq = 0;
function toolCall(name: string, args: unknown): ToolCallRequest {
  toolCallSeq++;
  return { id: `mock_call_${toolCallSeq}`, name, args };
}

function assistantToolCalls(content: string, toolCalls: ToolCallRequest[]): ChatWithToolsResult {
  return {
    message: { role: 'assistant', content, toolCalls },
    raw: JSON.stringify({ content, tool_calls: toolCalls }),
  };
}

// ============================================================================
// Helpers (shared between V1 + V2 mock paths)
// ============================================================================

function extractNumber(text: string, regex: RegExp): number {
  const match = text.match(regex);
  return match ? parseFloat(match[1]) : 0;
}

function detectV1AgentType(prompt: string): 'momentum' | 'meanReversion' | 'confirmation' | 'newsEvents' {
  const p = prompt.toLowerCase();
  if (p.includes('news and events analyst')) return 'newsEvents';
  if (p.includes('mean reversion')) return 'meanReversion';
  if (p.includes('confirmation')) return 'confirmation';
  return 'momentum';
}

function calculateV1Score(
  agentType: 'momentum' | 'meanReversion' | 'confirmation' | 'newsEvents',
  rsi: number,
  sma20: number,
  sma50: number,
  close: number,
  macdHistogram: number
): AgentOutput {
  let bullishScore = 0;
  let confidence = 0.5;
  const rationale: string[] = [];

  switch (agentType) {
    case 'momentum':
      if (close > sma20 && sma20 > sma50) {
        bullishScore += 0.4;
        rationale.push('Price above both SMAs indicates uptrend');
      } else if (close < sma20 && sma20 < sma50) {
        bullishScore -= 0.4;
        rationale.push('Price below both SMAs indicates downtrend');
      }
      if (rsi > 50 && rsi < 70) {
        bullishScore += 0.3;
        confidence += 0.1;
        rationale.push('RSI shows healthy bullish momentum');
      } else if (rsi < 50 && rsi > 30) {
        bullishScore -= 0.3;
        confidence += 0.1;
        rationale.push('RSI shows bearish momentum');
      } else if (rsi >= 70) {
        bullishScore -= 0.1;
        rationale.push('RSI overbought - momentum may be exhausting');
      } else if (rsi <= 30) {
        bullishScore += 0.1;
        rationale.push('RSI oversold - potential momentum reversal');
      }
      break;
    case 'meanReversion': {
      if (rsi >= 70) {
        bullishScore -= 0.5;
        confidence += 0.2;
        rationale.push('RSI overbought - expecting mean reversion down');
      } else if (rsi <= 30) {
        bullishScore += 0.5;
        confidence += 0.2;
        rationale.push('RSI oversold - expecting mean reversion up');
      }
      const deviation = sma20 > 0 ? (close - sma20) / sma20 : 0;
      if (deviation > 0.03) {
        bullishScore -= 0.3;
        rationale.push('Price extended above SMA20 - reversion likely');
      } else if (deviation < -0.03) {
        bullishScore += 0.3;
        rationale.push('Price extended below SMA20 - reversion likely');
      }
      break;
    }
    case 'confirmation':
      if (macdHistogram > 0) {
        bullishScore += 0.3;
        rationale.push('MACD histogram positive - confirms bullish momentum');
      } else if (macdHistogram < 0) {
        bullishScore -= 0.3;
        rationale.push('MACD histogram negative - confirms bearish momentum');
      }
      if (sma20 > sma50) {
        bullishScore += 0.2;
        rationale.push('Golden cross pattern (SMA20 > SMA50)');
      } else if (sma20 < sma50) {
        bullishScore -= 0.2;
        rationale.push('Death cross pattern (SMA20 < SMA50)');
      }
      confidence += 0.15;
      break;
    case 'newsEvents':
      bullishScore = 0.15;
      confidence = 0.3;
      rationale.push('Mock: Mild positive news sentiment detected');
      rationale.push('Mock: No major catalysts identified');
      break;
  }

  bullishScore = clamp(bullishScore, -1, 1);
  confidence = clamp(confidence, 0, 1);
  if (rationale.length === 0) rationale.push('No strong signals detected');
  return { bullishScore, confidence, rationale };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ============================================================================
// V2 specialist mock generators
// ============================================================================

function detectSpecialist(prompt: string): SpecialistName | null {
  const match = prompt.match(/\[SPECIALIST=([a-zA-Z]+)\]/);
  if (!match) return null;
  const name = match[1] as SpecialistName;
  const known: SpecialistName[] = [
    'trendRegime',
    'setupPattern',
    'momentum',
    'meanReversion',
    'volumeFlow',
    'newsEvents',
  ];
  return known.includes(name) ? name : null;
}

interface MockTechnicals {
  rsi: number;
  sma20: number;
  sma50: number;
  close: number;
  macdHistogram: number;
  volume: number;
  avgVolume: number;
}

function extractTechnicals(prompt: string): MockTechnicals {
  return {
    rsi: extractNumber(prompt, /RSI\(14\):\s*([\d.]+)/),
    sma20: extractNumber(prompt, /SMA\(20\):\s*\$?([\d.]+)/),
    sma50: extractNumber(prompt, /SMA\(50\):\s*\$?([\d.]+)/),
    close: extractNumber(prompt, /Close:\s*\$?([\d.]+)/),
    macdHistogram: extractNumber(prompt, /MACD Histogram:\s*([-\d.]+)/),
    volume: extractNumber(prompt, /Volume:\s*([\d,]+)/) || 0,
    avgVolume: extractNumber(prompt, /30-day avg:\s*([\d,]+)/) || 0,
  };
}

function generateSpecialistOutput(name: SpecialistName, prompt: string): SpecialistOutput {
  const t = extractTechnicals(prompt);
  switch (name) {
    case 'trendRegime':
      return mockTrendRegime(t);
    case 'setupPattern':
      return mockSetupPattern(t);
    case 'momentum':
      return mockMomentum(t);
    case 'meanReversion':
      return mockMeanReversion(t);
    case 'volumeFlow':
      return mockVolumeFlow(t);
    case 'newsEvents':
      return mockNewsEvents(t);
  }
}

function mockTrendRegime(t: MockTechnicals): SpecialistOutput {
  // Stage 1-4 + regime classification using close vs SMAs
  let regime: 'bull_trending' | 'bull_choppy' | 'bear_trending' | 'bear_choppy';
  let stage: 1 | 2 | 3 | 4;
  let bullishScore = 0;
  const rationale: string[] = [];

  if (t.close > t.sma20 && t.sma20 > t.sma50) {
    regime = 'bull_trending';
    stage = 2;
    bullishScore = 0.5;
    rationale.push('Close > SMA20 > SMA50: stage-2 markup phase, bull-trending regime');
    rationale.push('Trend-following longs are in scope; mean-reversion shorts are not');
  } else if (t.close < t.sma20 && t.sma20 < t.sma50) {
    regime = 'bear_trending';
    stage = 4;
    bullishScore = -0.5;
    rationale.push('Close < SMA20 < SMA50: stage-4 markdown phase, bear-trending regime');
    rationale.push('Block trend-following longs; only mean-reversion oversold setups');
  } else if (t.close > t.sma50) {
    regime = 'bull_choppy';
    stage = 1;
    bullishScore = 0.1;
    rationale.push('Close above SMA50 but SMAs not aligned: stage-1 basing within larger uptrend');
    rationale.push('Range-bound; favor selective setups');
  } else {
    regime = 'bear_choppy';
    stage = 3;
    bullishScore = -0.1;
    rationale.push('Close below SMA50 with SMAs unaligned: stage-3 distribution');
    rationale.push('Avoid new long exposure');
  }

  return {
    bullishScore,
    confidence: 0.65,
    rationale,
    flags: [],
    extras: { regime, stage },
  };
}

function mockSetupPattern(t: MockTechnicals): SpecialistOutput {
  let setupName: string | null = null;
  let qualityGrade: 'A' | 'B' | 'C' | 'none' = 'none';
  let bullishScore = 0;
  const flags: SpecialistOutput['flags'] = [];
  const rationale: string[] = [];

  const distFromSma20 = t.sma20 > 0 ? (t.close - t.sma20) / t.sma20 : 0;

  if (t.close > t.sma50 && distFromSma20 > -0.005 && distFromSma20 < 0.01) {
    setupName = 'pullback_to_sma20';
    qualityGrade = 'B';
    bullishScore = 0.4;
    flags.push('pullback');
    rationale.push('Price tagged SMA20 from above within rising trend (pullback-to-MA setup)');
    rationale.push('Grade B: confirmation candle not yet present, but structure intact');
  } else if (t.close > t.sma20 && t.macdHistogram > 0 && t.rsi > 55 && t.rsi < 70) {
    setupName = 'breakout_continuation';
    qualityGrade = 'B';
    bullishScore = 0.35;
    flags.push('breakout');
    rationale.push('Continuation breakout: price > SMA20, RSI healthy, MACD positive');
    rationale.push('Volume confirmation needed for grade-A entry');
  } else if (t.rsi <= 30 && t.close < t.sma50) {
    setupName = 'mean_reversion_oversold';
    qualityGrade = 'C';
    bullishScore = 0.2;
    flags.push('oversold');
    rationale.push('Counter-trend oversold setup; only viable in non-bear-trending regime');
    rationale.push('Tight stop required; this is a bounce trade, not a position trade');
  } else {
    setupName = null;
    qualityGrade = 'none';
    rationale.push('No clean named setup present today');
    rationale.push('Best action: wait for setup or trail existing position');
  }

  return {
    bullishScore,
    confidence: setupName ? 0.7 : 0.3,
    rationale,
    flags,
    extras: { setupName, qualityGrade },
  };
}

function mockMomentum(t: MockTechnicals): SpecialistOutput {
  let bullishScore = 0;
  let momentumState: 'accelerating' | 'steady' | 'fading' | 'exhausted' = 'steady';
  const flags: SpecialistOutput['flags'] = [];
  const rationale: string[] = [];

  if (t.rsi >= 70) {
    momentumState = 'exhausted';
    bullishScore = -0.2;
    flags.push('overbought');
    rationale.push('RSI ≥ 70: momentum is overbought / exhausted');
    rationale.push('Avoid fresh longs into overbought conditions; trail existing positions');
  } else if (t.rsi >= 55 && t.macdHistogram > 0) {
    momentumState = 'accelerating';
    bullishScore = 0.5;
    rationale.push('RSI in healthy 55-69 zone with positive MACD: momentum accelerating');
    rationale.push('Trend-following setups have a tailwind here');
  } else if (t.rsi < 45 && t.macdHistogram < 0) {
    momentumState = 'fading';
    bullishScore = -0.5;
    rationale.push('RSI < 45 with negative MACD: momentum fading');
    rationale.push('Bearish bias; do not chase counter-trend longs');
  } else if (t.rsi <= 30) {
    momentumState = 'exhausted';
    bullishScore = 0.1;
    flags.push('oversold');
    rationale.push('RSI ≤ 30: bearish momentum exhausted, watch for reversal');
    rationale.push('Wait for a reversal candle before adding long exposure');
  } else {
    momentumState = 'steady';
    rationale.push('RSI in mid-range: momentum is neutral/steady');
    rationale.push('No actionable momentum signal');
  }

  return {
    bullishScore,
    confidence: 0.6,
    rationale,
    flags,
    extras: { momentumState },
  };
}

function mockMeanReversion(t: MockTechnicals): SpecialistOutput {
  let bullishScore = 0;
  const flags: SpecialistOutput['flags'] = [];
  const rationale: string[] = [];

  // Approximate ATR using SMA20 distance for the mock
  const distAbs = Math.abs(t.close - t.sma20);
  const extensionATR = t.sma20 > 0 ? distAbs / (t.sma20 * 0.02) : 0;
  let revertProbability = 0.3;

  if (t.rsi >= 70) {
    bullishScore = -0.5;
    flags.push('overbought');
    revertProbability = 0.7;
    rationale.push('RSI ≥ 70 + extended above SMA20: revert-down probable');
    rationale.push('Edge is strongest when broader regime is choppy/range-bound, not trending');
  } else if (t.rsi <= 30) {
    bullishScore = 0.5;
    flags.push('oversold');
    revertProbability = 0.7;
    rationale.push('RSI ≤ 30 + extended below SMA20: revert-up probable');
    rationale.push('Tight stop required; this is a bounce, not a position trade');
  } else {
    rationale.push('No mean-reversion edge: RSI in mid-range');
    rationale.push('Price not extended enough from SMA20');
  }

  return {
    bullishScore,
    confidence: flags.length > 0 ? 0.65 : 0.25,
    rationale,
    flags,
    extras: {
      extensionATR: Math.round(extensionATR * 100) / 100,
      revertProbability,
    },
  };
}

function mockVolumeFlow(t: MockTechnicals): SpecialistOutput {
  let bullishScore = 0;
  const flags: SpecialistOutput['flags'] = [];
  const rationale: string[] = [];

  const volRatio = t.avgVolume > 0 ? t.volume / t.avgVolume : 1;

  // Without OBV/AccDist data, approximate accumulation from price-vs-SMA + volume
  let accumulationScore = 0;
  if (t.close > t.sma20 && volRatio > 1.5) {
    accumulationScore = 0.5;
    bullishScore = 0.4;
    flags.push('volume_surge');
    rationale.push(`Volume surge ${volRatio.toFixed(1)}× avg on price > SMA20: accumulation`);
    rationale.push('Conviction-grade demand; supports trend-continuation setups');
  } else if (t.close < t.sma20 && volRatio > 1.5) {
    accumulationScore = -0.5;
    bullishScore = -0.4;
    flags.push('volume_surge');
    rationale.push(`Volume surge ${volRatio.toFixed(1)}× avg on price < SMA20: distribution`);
    rationale.push('Heavy selling — avoid bottom-fishing without clear support');
  } else if (volRatio < 0.6) {
    accumulationScore = 0;
    flags.push('volume_dry');
    rationale.push(`Volume ${volRatio.toFixed(1)}× avg: low conviction`);
    rationale.push('No actionable flow signal — flat conditions');
  } else {
    accumulationScore = t.close > t.sma20 ? 0.1 : -0.1;
    rationale.push('Volume in normal range; subtle directional bias from price location');
    rationale.push('Wait for volume confirmation before sizing');
  }

  return {
    bullishScore,
    confidence: flags.length > 0 ? 0.6 : 0.3,
    rationale,
    flags,
    extras: {
      accumulationScore,
      surgeDays: flags.includes('volume_surge') ? 1 : 0,
      volumeRatio: Math.round(volRatio * 100) / 100,
    },
  };
}

// ============================================================================
// V2 head-trader mock generator
// ============================================================================

interface HeadTraderMeta {
  weightedScore: number;
  regime: string | null;
  setupName: string | null;
  qualityGrade: string | null;
  momentumState: string | null;
  drawdownPct: number;
  hasPosition: boolean;
  catalystImminent: boolean;
  earningsWithinDays: number | null;
  flagsUnion: string[];
  config?: {
    riskTolerancePct: number;
    maxRiskPctPerTrade: number;
    drawdownHalveAt: number;
    drawdownCloseOnlyAt: number;
    drawdownHardHaltAt: number;
    defaultStopLossPct: number;
    defaultTarget1R: number;
    defaultTarget2R: number;
    defaultTimeStopBars: number;
  };
}

const FALLBACK_CFG = {
  riskTolerancePct: 1.0,
  maxRiskPctPerTrade: 0.02,
  drawdownHalveAt: 0.10,
  drawdownCloseOnlyAt: 0.15,
  drawdownHardHaltAt: 0.20,
  defaultStopLossPct: 0.05,
  defaultTarget1R: 1.6,
  defaultTarget2R: 3.2,
  defaultTimeStopBars: 10,
};

const REGIME_BEAR_ALLOWED_SETUPS = new Set([
  'mean_reversion_oversold',
  'gap_fill',
  'failed_breakdown',
]);

function generateHeadTraderPlan(prompt: string): unknown {
  const meta = extractMeta(prompt);
  const cfg = meta.config ?? FALLBACK_CFG;
  const close = extractNumber(prompt, /Close:\s*\$([\d.]+)/);

  // Kill criteria — these force HOLD/CLOSE regardless of weightedScore.
  if (meta.drawdownPct >= cfg.drawdownCloseOnlyAt) {
    return holdPlan(close, meta, [
      'drawdown >= 15% — close-only mode',
    ], 'drawdown_ladder');
  }
  if (meta.catalystImminent && meta.earningsWithinDays !== null && meta.earningsWithinDays <= 2) {
    return holdPlan(close, meta, [
      'catalyst within 2 days — avoid binary risk',
    ], 'catalyst_imminent');
  }
  if (
    meta.regime === 'bear_trending' &&
    !(meta.setupName && REGIME_BEAR_ALLOWED_SETUPS.has(meta.setupName))
  ) {
    return holdPlan(close, meta, [
      'bear-trending regime without a regime-allowed setup',
    ], 'regime_gate');
  }
  if (meta.momentumState === 'exhausted' && meta.flagsUnion.includes('overbought')) {
    return holdPlan(close, meta, [
      'momentum exhausted with overbought flag',
    ], 'momentum_exhaustion');
  }

  const conviction = convictionFrom(meta.weightedScore);
  if (conviction < 0.5) {
    return holdPlan(close, meta, [
      `conviction ${conviction.toFixed(2)} below 0.5 threshold`,
    ], 'low_conviction');
  }

  // CLOSE if bearish thesis and we hold a position
  if (meta.weightedScore < -0.4 && meta.hasPosition) {
    return {
      action: 'CLOSE',
      conviction,
      setupName: null,
      entry: close,
      stop: null,
      target1: null,
      target2: null,
      riskPctOfEquity: 0,
      timeStop: null,
      invalidationCriteria: ['bearish weighted score with open long position'],
      reasoningTrace: [
        {
          round: 1,
          thought: `Specialists tilt bearish (${meta.weightedScore.toFixed(2)}); closing existing long.`,
          toolUsed: null,
        },
      ],
    };
  }

  // BUY when bullish thesis, no position, and we cleared kill criteria.
  if (meta.weightedScore > 0.4 && !meta.hasPosition) {
    const stop = round2(close * (1 - cfg.defaultStopLossPct));
    const r = close - stop;
    const target1 = round2(close + cfg.defaultTarget1R * r);
    const target2 = round2(close + cfg.defaultTarget2R * r);
    const riskPct = Math.min(riskPctFromConviction(conviction), cfg.maxRiskPctPerTrade);
    return {
      action: 'BUY',
      conviction,
      setupName: meta.setupName,
      entry: close,
      stop,
      target1,
      target2,
      riskPctOfEquity: riskPct,
      timeStop: cfg.defaultTimeStopBars,
      invalidationCriteria: [
        meta.setupName ? `${meta.setupName} setup invalidated` : 'thesis violated',
        `daily close below ${stop.toFixed(2)}`,
      ],
      reasoningTrace: [
        {
          round: 1,
          thought: `Weighted ${meta.weightedScore.toFixed(2)} + ${meta.regime} regime + ${meta.setupName ?? 'no named'} setup. Sized for ${(riskPct * 100).toFixed(2)}% risk.`,
          toolUsed: null,
        },
      ],
    };
  }

  // Default: HOLD
  return holdPlan(close, meta, ['no edge identified today'], 'no_edge');
}

function extractMeta(prompt: string): HeadTraderMeta {
  const match = prompt.match(/META:\s*(\{.*?\})\s*\n/s);
  if (!match) {
    return {
      weightedScore: 0,
      regime: null,
      setupName: null,
      qualityGrade: null,
      momentumState: null,
      drawdownPct: 0,
      hasPosition: false,
      catalystImminent: false,
      earningsWithinDays: null,
      flagsUnion: [],
    };
  }
  try {
    return JSON.parse(match[1]) as HeadTraderMeta;
  } catch {
    return {
      weightedScore: 0,
      regime: null,
      setupName: null,
      qualityGrade: null,
      momentumState: null,
      drawdownPct: 0,
      hasPosition: false,
      catalystImminent: false,
      earningsWithinDays: null,
      flagsUnion: [],
    };
  }
}

function holdPlan(
  close: number,
  meta: HeadTraderMeta,
  reasons: string[],
  killReason: string
): unknown {
  return {
    action: 'HOLD',
    conviction: Math.max(0, Math.abs(meta.weightedScore) - 0.05),
    setupName: null,
    entry: close,
    stop: null,
    target1: null,
    target2: null,
    riskPctOfEquity: 0,
    timeStop: null,
    invalidationCriteria: [],
    reasoningTrace: [
      {
        round: 1,
        thought: `HOLD (${killReason}): ${reasons.join('; ')}`,
        toolUsed: null,
      },
    ],
  };
}

function convictionFrom(weightedScore: number): number {
  const abs = Math.abs(weightedScore);
  if (abs < 0.4) return abs * 1.0; // < 0.4 stays sub-threshold
  if (abs < 0.6) return 0.6;
  if (abs < 0.8) return 0.78;
  return 0.9;
}

function riskPctFromConviction(conviction: number): number {
  if (conviction < 0.5) return 0;
  if (conviction < 0.7) return 0.005;
  if (conviction < 0.85) return 0.01;
  return 0.015;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mockNewsEvents(_t: MockTechnicals): SpecialistOutput {
  return {
    bullishScore: 0.1,
    confidence: 0.3,
    rationale: [
      'Mock: no major catalysts in window',
      'Mock: ambient sentiment slightly positive',
    ],
    flags: [],
    extras: {
      catalystImminent: false,
      earningsWithinDays: null,
      sentimentNet: 0.1,
    },
  };
}
