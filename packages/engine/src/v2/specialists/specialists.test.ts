import { SpecialistOutputSchema } from '@capitalforge/shared';
import { TechnicalData, SandboxContext } from '../../types';
import { MockLLMService } from '../../services/llm.mock';
import {
  SPECIALIST_ROSTER,
  runSpecialist,
  trendRegimeSpecialist,
  setupPatternSpecialist,
  momentumSpecialist,
  meanReversionSpecialist,
  volumeFlowSpecialist,
  newsEventsSpecialist,
} from './index';

const baseTechnicals: TechnicalData = {
  symbol: 'TEST',
  date: '2026-04-27',
  close: 105,
  rsi: 60,
  sma20: 100,
  sma50: 95,
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

describe('V2 specialist roster', () => {
  it('exposes exactly the six specialists in the planned order', () => {
    const names = SPECIALIST_ROSTER.map((s) => s.name);
    expect(names).toEqual([
      'trendRegime',
      'setupPattern',
      'momentum',
      'meanReversion',
      'volumeFlow',
      'newsEvents',
    ]);
  });

  it('every specialist has a non-empty prompt with the SPECIALIST marker', () => {
    for (const specialist of SPECIALIST_ROSTER) {
      const prompt = specialist.buildPrompt({
        symbol: 'TEST',
        technicals: baseTechnicals,
        sandbox: baseSandbox,
      });
      expect(prompt).toContain(`[SPECIALIST=${specialist.name}]`);
      expect(prompt.length).toBeGreaterThan(200);
    }
  });

  it('every specialist returns a SpecialistOutput valid against the shared schema', async () => {
    const llm = new MockLLMService();
    for (const specialist of SPECIALIST_ROSTER) {
      const result = await runSpecialist(
        specialist,
        { symbol: 'TEST', technicals: baseTechnicals, sandbox: baseSandbox },
        llm
      );
      const validation = SpecialistOutputSchema.safeParse(result.output);
      expect(validation.success).toBe(true);
      expect(result.output.bullishScore).toBeGreaterThanOrEqual(-1);
      expect(result.output.bullishScore).toBeLessThanOrEqual(1);
      expect(result.output.confidence).toBeGreaterThanOrEqual(0);
      expect(result.output.confidence).toBeLessThanOrEqual(1);
      expect(result.output.rationale.length).toBeGreaterThanOrEqual(2);
      expect(result.output.rationale.length).toBeLessThanOrEqual(6);
    }
  });
});

describe('V2 specialists — directional behavior on archetypal inputs', () => {
  const llm = new MockLLMService();
  const ctx = (overrides: Partial<TechnicalData>) => ({
    symbol: 'TEST',
    technicals: { ...baseTechnicals, ...overrides },
    sandbox: baseSandbox,
  });

  it('trendRegime classifies bull_trending when close > SMA20 > SMA50', async () => {
    const result = await runSpecialist(trendRegimeSpecialist, ctx({}), llm);
    expect(result.output.extras).toMatchObject({ regime: 'bull_trending', stage: 2 });
    expect(result.output.bullishScore).toBeGreaterThan(0);
  });

  it('trendRegime classifies bear_trending when close < SMA20 < SMA50', async () => {
    const result = await runSpecialist(
      trendRegimeSpecialist,
      ctx({ close: 90, sma20: 95, sma50: 100 }),
      llm
    );
    expect(result.output.extras).toMatchObject({ regime: 'bear_trending', stage: 4 });
    expect(result.output.bullishScore).toBeLessThan(0);
  });

  it('setupPattern recognizes pullback-to-SMA20 in an uptrend', async () => {
    const result = await runSpecialist(
      setupPatternSpecialist,
      ctx({ close: 100.5, sma20: 100, sma50: 95 }), // tagged SMA20 from above
      llm
    );
    expect(result.output.extras).toMatchObject({ setupName: 'pullback_to_sma20' });
    expect(result.output.flags).toContain('pullback');
  });

  it('momentum flags exhausted when RSI >= 70', async () => {
    const result = await runSpecialist(momentumSpecialist, ctx({ rsi: 75 }), llm);
    expect(result.output.flags).toContain('overbought');
    expect(result.output.extras).toMatchObject({ momentumState: 'exhausted' });
    expect(result.output.bullishScore).toBeLessThanOrEqual(0);
  });

  it('meanReversion flags oversold revert-up when RSI <= 30', async () => {
    const result = await runSpecialist(
      meanReversionSpecialist,
      ctx({ rsi: 25, close: 90, sma20: 100 }),
      llm
    );
    expect(result.output.flags).toContain('oversold');
    expect(result.output.bullishScore).toBeGreaterThan(0);
  });

  it('volumeFlow detects volume_surge with bullish bias when price > SMA20 and volume > 1.5x avg', async () => {
    const result = await runSpecialist(
      volumeFlowSpecialist,
      ctx({ close: 110, sma20: 100, volume: 2_000_000, avgVolume: 1_000_000 }),
      llm
    );
    expect(result.output.flags).toContain('volume_surge');
    expect(result.output.bullishScore).toBeGreaterThan(0);
  });

  it('newsEvents returns low-confidence neutral output by default in mock mode', async () => {
    const result = await runSpecialist(newsEventsSpecialist, ctx({}), llm);
    expect(result.output.confidence).toBeLessThan(0.5);
    expect(Math.abs(result.output.bullishScore)).toBeLessThanOrEqual(0.3);
  });
});
