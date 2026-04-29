import { TradePlanSchema } from '@capitalforge/shared';
import type { SandboxContext, TechnicalData } from '@capitalforge/shared';
import { MockLLMService } from '../../services/llm.mock';
import { SPECIALIST_ROSTER, runSpecialist, SpecialistRunResult } from '../specialists';
import { deliberate } from '../engine/headTrader';
import { buildHeadTraderToolRegistry } from './index';
import { createMockAlpacaService } from '../../services/alpaca.mock';

const baseTechnicals: TechnicalData = {
  symbol: 'TEST',
  date: '2026-04-28',
  close: 100,
  rsi: 60,
  sma20: 95,
  sma50: 90,
  macdHistogram: 0.5,
  volume: 1_500_000,
  avgVolume: 1_000_000,
};

const baseSandbox: SandboxContext = {
  allocatedCapital: 2000,
  currentEquity: 2000,
  peakEquity: 2000,
  cashBalance: 2000,
  positionQty: 0,
  positionSymbol: null,
  positionAvgPrice: null,
  drawdownPct: 0,
};

async function runSpecialists(
  technicals: TechnicalData,
  sandbox: SandboxContext
): Promise<SpecialistRunResult[]> {
  const llm = new MockLLMService();
  const results: SpecialistRunResult[] = [];
  for (const specialist of SPECIALIST_ROSTER) {
    results.push(await runSpecialist(specialist, { symbol: 'TEST', technicals, sandbox }, llm));
  }
  return results;
}

describe('M4 tool registry', () => {
  it('builds the head-trader registry with all 10 tools including a terminal submit_decision', () => {
    const reg = buildHeadTraderToolRegistry();
    const names = reg.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_market_regime',
        'get_indicator',
        'get_atr_stop_suggestion',
        'get_sector_performance',
        'get_relative_strength',
        'get_recent_news',
        'get_earnings_calendar',
        'get_position_history',
        'get_correlations',
        'submit_decision',
      ])
    );
    const submit = reg.get('submit_decision');
    expect(submit?.terminal).toBe(true);
  });

  it('exposes valid OpenAI tool descriptors for every tool', () => {
    const reg = buildHeadTraderToolRegistry();
    const descriptors = reg.toOpenAITools();
    for (const d of descriptors) {
      expect(d.type).toBe('function');
      expect(d.function.name.length).toBeGreaterThan(0);
      expect(d.function.description.length).toBeGreaterThan(0);
      expect(d.function.parameters).toBeDefined();
    }
  });
});

describe('M4 head-trader tool-using deliberation', () => {
  it('runs a full multi-round loop that ends with submit_decision', async () => {
    const llm = new MockLLMService();
    const alpaca = createMockAlpacaService();
    const tools = buildHeadTraderToolRegistry();
    const specialists = await runSpecialists(baseTechnicals, baseSandbox);

    const result = await deliberate(
      { symbol: 'TEST', technicals: baseTechnicals, sandbox: baseSandbox, specialists },
      llm,
      'mock-model',
      tools,
      {
        symbol: 'TEST',
        cycleDate: baseTechnicals.date,
        technicals: baseTechnicals,
        sandbox: baseSandbox,
        alpaca,
        news: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma: {} as any,
      }
    );

    expect(TradePlanSchema.safeParse(result.plan).success).toBe(true);
    expect(result.rounds).toBeGreaterThanOrEqual(2);
    expect(result.rounds).toBeLessThanOrEqual(6);
    // Should have at least one non-terminal tool call recorded.
    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.toolCalls.find((t) => t.toolName === 'get_market_regime')).toBeDefined();
    // submit_decision is NOT persisted as a ToolCall (it's the terminal signal).
    expect(result.toolCalls.find((t) => t.toolName === 'submit_decision')).toBeUndefined();
    // Reasoning trace has thoughts from the LLM rounds.
    expect(result.plan.reasoningTrace.length).toBeGreaterThan(0);
  });

  it('returns the get_atr_stop_suggestion tool result with a sane stop below entry', async () => {
    const tools = buildHeadTraderToolRegistry();
    const alpaca = createMockAlpacaService();
    const result = await tools.invoke(
      'get_atr_stop_suggestion',
      { entry: 100, multiplier: 1.5 },
      {
        symbol: 'TEST',
        cycleDate: '2026-04-28',
        technicals: baseTechnicals,
        sandbox: baseSandbox,
        alpaca,
        news: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma: {} as any,
      }
    );
    expect(result.errored).toBe(false);
    const r = result.result as { atr14: number; suggestedStop: number; entry: number };
    expect(r.atr14).toBeGreaterThanOrEqual(0);
    expect(r.suggestedStop).toBeLessThan(r.entry);
  });

  it('rejects malformed args via Zod validation', async () => {
    const tools = buildHeadTraderToolRegistry();
    const alpaca = createMockAlpacaService();
    const result = await tools.invoke(
      'get_atr_stop_suggestion',
      { entry: -1 }, // negative entry — invalid
      {
        symbol: 'TEST',
        cycleDate: '2026-04-28',
        technicals: baseTechnicals,
        sandbox: baseSandbox,
        alpaca,
        news: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma: {} as any,
      }
    );
    expect(result.errored).toBe(true);
    expect(result.errorMessage).toMatch(/validation/i);
  });
});
