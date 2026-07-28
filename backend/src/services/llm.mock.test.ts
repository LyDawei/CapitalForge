import { SmartMockLlmService } from './llm.mock';

const llm = new SmartMockLlmService();

describe('SmartMockLlmService', () => {
  it('returns specialist-shaped output for trendRegime', async () => {
    const res = await llm.complete({ prompt: 'You are a market-regime analyst.\nInputs...' });
    const parsed = JSON.parse(res.text);
    expect(typeof parsed.bullishScore).toBe('number');
    expect(typeof parsed.confidence).toBe('number');
    expect(Array.isArray(parsed.rationale)).toBe(true);
    expect(parsed.rationale.length).toBeGreaterThanOrEqual(2);
    expect(parsed.extras.regime).toMatch(/bull_|bear_/);
    expect([1, 2, 3, 4]).toContain(parsed.extras.stage);
  });

  it('returns head-trader-shaped output', async () => {
    const res = await llm.complete({ prompt: 'You are the Head Trader. Read all...' });
    const parsed = JSON.parse(res.text);
    expect(['BUY', 'SELL', 'HOLD', 'CLOSE']).toContain(parsed.action);
    expect(typeof parsed.conviction).toBe('number');
    expect(typeof parsed.entry).toBe('number');
    expect(Array.isArray(parsed.reasoningTrace)).toBe(true);
  });

  it('returns riskAuditor-shaped output', async () => {
    const res = await llm.complete({ prompt: 'You are the Risk Auditor...' });
    const parsed = JSON.parse(res.text);
    expect(['A', 'B', 'C', 'F']).toContain(parsed.extras.riskGrade);
    expect(Array.isArray(parsed.extras.objections)).toBe(true);
  });

  it('returns devilsAdvocate-shaped output', async () => {
    const res = await llm.complete({ prompt: "You are the Devil's Advocate..." });
    const parsed = JSON.parse(res.text);
    expect(typeof parsed.extras.opposeScore).toBe('number');
    expect(Array.isArray(parsed.extras.topRisks)).toBe(true);
    expect(parsed.extras.topRisks.length).toBe(3);
  });

  it('returns deterministic output for the same prompt', async () => {
    const prompt = 'You are a momentum analyst.\nSome technicals here...';
    const r1 = await llm.complete({ prompt });
    const r2 = await llm.complete({ prompt });
    expect(r1.text).toBe(r2.text);
  });

  it('populates latency + tokens + cost', async () => {
    const res = await llm.complete({ prompt: 'Some prompt text' });
    expect(res.latencyMs).toBeGreaterThan(0);
    expect(res.tokensIn).toBeGreaterThan(0);
    expect(res.tokensOut).toBeGreaterThan(0);
    expect(res.provider).toBe('mock');
    expect(typeof res.costUsd).toBe('number');
  });
});
