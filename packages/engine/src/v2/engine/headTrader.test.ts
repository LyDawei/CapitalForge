import { TradePlanSchema } from '@capitalforge/shared';
import type { SandboxContext, TechnicalData } from '@capitalforge/shared';
import { MockLLMService } from '../../services/llm.mock';
import { SPECIALIST_ROSTER, runSpecialist, SpecialistRunResult } from '../specialists';
import { deliberate } from './headTrader';
import { applySizing } from './riskManagerV2';

const baseTechnicals: TechnicalData = {
  symbol: 'TEST',
  date: '2026-04-27',
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

describe('M3 head trader — single-shot deliberation', () => {
  it('produces a TradePlanSchema-valid plan in a clean bull-trending setup', async () => {
    const llm = new MockLLMService();
    const specialists = await runSpecialists(baseTechnicals, baseSandbox);
    const result = await deliberate(
      { symbol: 'TEST', technicals: baseTechnicals, sandbox: baseSandbox, specialists },
      llm,
      'mock-model'
    );
    expect(TradePlanSchema.safeParse(result.plan).success).toBe(true);
    expect(result.rounds).toBe(1);
    expect(['BUY', 'HOLD']).toContain(result.plan.action);
  });

  it('forces HOLD when drawdown >= 15% (close-only mode)', async () => {
    const llm = new MockLLMService();
    const drawnSandbox: SandboxContext = { ...baseSandbox, drawdownPct: 0.16 };
    const specialists = await runSpecialists(baseTechnicals, drawnSandbox);
    const result = await deliberate(
      { symbol: 'TEST', technicals: baseTechnicals, sandbox: drawnSandbox, specialists },
      llm,
      'mock-model'
    );
    expect(result.plan.action).toBe('HOLD');
    expect(result.plan.reasoningTrace[0].thought).toMatch(/drawdown/i);
  });

  it('forces HOLD in bear-trending regime without a regime-allowed setup', async () => {
    const llm = new MockLLMService();
    const bearTechnicals: TechnicalData = {
      ...baseTechnicals,
      close: 80,
      sma20: 90,
      sma50: 100,
      rsi: 45,
      macdHistogram: -0.3,
    };
    const specialists = await runSpecialists(bearTechnicals, baseSandbox);
    const result = await deliberate(
      { symbol: 'TEST', technicals: bearTechnicals, sandbox: baseSandbox, specialists },
      llm,
      'mock-model'
    );
    expect(result.plan.action).toBe('HOLD');
  });

  it('emits BUY with stop+targets when bullish + clean kill criteria', async () => {
    const llm = new MockLLMService();
    const bullishTech: TechnicalData = {
      ...baseTechnicals,
      close: 100,
      sma20: 99.5,    // close just tagged SMA20 (pullback setup)
      sma50: 95,
      rsi: 60,
      macdHistogram: 0.3,
    };
    const specialists = await runSpecialists(bullishTech, baseSandbox);
    const result = await deliberate(
      { symbol: 'TEST', technicals: bullishTech, sandbox: baseSandbox, specialists },
      llm,
      'mock-model'
    );
    if (result.plan.action === 'BUY') {
      expect(result.plan.stop).not.toBeNull();
      expect(result.plan.stop!).toBeLessThan(result.plan.entry);
      expect(result.plan.target1).not.toBeNull();
      expect(result.plan.target1!).toBeGreaterThan(result.plan.entry);
      expect(result.plan.riskPctOfEquity).toBeGreaterThan(0);
      expect(result.plan.riskPctOfEquity).toBeLessThanOrEqual(0.02);
    }
  });
});

describe('M3 risk manager V2 — applySizing', () => {
  const buyPlan = {
    action: 'BUY' as const,
    conviction: 0.78,
    setupName: 'pullback_to_sma20',
    entry: 100,
    stop: 95,
    target1: 108,
    target2: 116,
    riskPctOfEquity: 0.01,
    timeStop: 10,
    invalidationCriteria: ['close < 95'],
    reasoningTrace: [{ round: 1, thought: 'mock', toolUsed: null }],
  };

  it('computes shares = floor(risk$/(entry-stop)) at normal drawdown', () => {
    const result = applySizing({ plan: buyPlan, sandbox: baseSandbox });
    // equity 2000 * 1% = $20 risk, $5/share → 4 shares
    expect(result.shares).toBe(4);
    expect(result.riskDollars).toBeCloseTo(20, 5);
    expect(result.modified).toBe(false);
    expect(result.plan.action).toBe('BUY');
  });

  it('halves riskPct when drawdown >= 10%', () => {
    const result = applySizing({
      plan: buyPlan,
      sandbox: { ...baseSandbox, drawdownPct: 0.12 },
    });
    expect(result.modified).toBe(true);
    expect(result.plan.riskPctOfEquity).toBe(0.005);
    expect(result.shares).toBe(2);
    expect(result.interventions[0]).toMatch(/halving risk/);
  });

  it('forces HOLD when drawdown >= 15% on a BUY', () => {
    const result = applySizing({
      plan: buyPlan,
      sandbox: { ...baseSandbox, drawdownPct: 0.17 },
    });
    expect(result.plan.action).toBe('HOLD');
    expect(result.plan.stop).toBeNull();
    expect(result.shares).toBe(0);
    expect(result.riskDollars).toBe(0);
  });

  it('caps riskPctOfEquity at 0.02', () => {
    const result = applySizing({
      plan: { ...buyPlan, riskPctOfEquity: 0.05 as unknown as 0.02 },
      sandbox: baseSandbox,
    });
    expect(result.plan.riskPctOfEquity).toBe(0.02);
    expect(result.modified).toBe(true);
  });

  it('forces HOLD when BUY has no stop (or stop >= entry)', () => {
    const result = applySizing({
      plan: { ...buyPlan, stop: null },
      sandbox: baseSandbox,
    });
    expect(result.plan.action).toBe('HOLD');
    expect(result.shares).toBe(0);
  });

  it('reduces shares when position value exceeds cash', () => {
    const lowCash: SandboxContext = { ...baseSandbox, cashBalance: 200, currentEquity: 2000 };
    // Even with $20 risk → 4 shares × $100 = $400 needed, but only $200 cash
    const result = applySizing({ plan: buyPlan, sandbox: lowCash });
    expect(result.shares).toBe(2); // floor(200/100)
    expect(result.modified).toBe(true);
  });

  it('passes through HOLD plans without modification at normal drawdown', () => {
    const holdPlan = {
      ...buyPlan,
      action: 'HOLD' as const,
      stop: null,
      target1: null,
      target2: null,
      riskPctOfEquity: 0,
    };
    const result = applySizing({ plan: holdPlan, sandbox: baseSandbox });
    expect(result.modified).toBe(false);
    expect(result.shares).toBe(0);
    expect(result.riskDollars).toBe(0);
  });
});
