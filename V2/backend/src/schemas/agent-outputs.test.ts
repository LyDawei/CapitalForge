import {
  validateAgentOutput,
  outputContractFor,
  hasContract,
  schemaFor,
  ALL_AGENT_NAMES,
} from './agent-outputs';

describe('agent-outputs.validateAgentOutput', () => {
  describe('specialist agents', () => {
    const specialistAgents = [
      'trendRegime',
      'setupPattern',
      'momentum',
      'meanReversion',
      'volumeFlow',
      'newsEvents',
      'macroContext',
      'liquiditySlippage',
      'riskAuditor',
      'devilsAdvocate',
    ];

    it.each(specialistAgents)('accepts a minimal valid specialist output for %s', (name) => {
      const raw = JSON.stringify({
        bullishScore: 0.4,
        confidence: 0.7,
        rationale: ['Price above SMA20', 'RSI rising steadily'],
        flags: [],
        extras: {},
      });
      const r = validateAgentOutput(name, raw);
      expect(r.ok).toBe(true);
    });

    it.each(specialistAgents)('rejects rationale with < 2 entries for %s', (name) => {
      const raw = JSON.stringify({
        bullishScore: 0.4,
        confidence: 0.7,
        rationale: ['only one'],
        flags: [],
      });
      const r = validateAgentOutput(name, raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/rationale/);
    });

    it.each(specialistAgents)('rejects bullishScore out of range for %s', (name) => {
      const raw = JSON.stringify({
        bullishScore: 1.5,
        confidence: 0.7,
        rationale: ['a', 'b'],
        flags: [],
      });
      const r = validateAgentOutput(name, raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/bullishScore/);
    });

    it.each(specialistAgents)('rejects confidence > 1 for %s', (name) => {
      const raw = JSON.stringify({
        bullishScore: 0,
        confidence: 1.4,
        rationale: ['a', 'b'],
      });
      const r = validateAgentOutput(name, raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/confidence/);
    });

    it.each(specialistAgents)('rejects missing bullishScore for %s', (name) => {
      const raw = JSON.stringify({
        confidence: 0.5,
        rationale: ['a', 'b'],
      });
      const r = validateAgentOutput(name, raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/bullishScore/);
    });
  });

  describe('headTrader', () => {
    it('accepts a minimal valid head trader output', () => {
      const raw = JSON.stringify({ action: 'BUY', conviction: 0.6 });
      const r = validateAgentOutput('headTrader', raw);
      expect(r.ok).toBe(true);
    });

    it('accepts a rich head trader output', () => {
      const raw = JSON.stringify({
        action: 'HOLD',
        conviction: 0.4,
        setupName: null,
        entry: 175.42,
        stop: 170.0,
        target1: 185.0,
        target2: 195.0,
        riskPctOfEquity: 0.015,
        timeStopBars: 10,
        expectedRMultiple: 2.0,
        invalidationCriteria: ['close below stop'],
        weightedFactors: [{ specialist: 'trendRegime', weight: 0.2, contribution: 'bull_trending' }],
        reasoningTrace: [{ round: 1, thought: 'aligned bullish read', toolUsed: null }],
      });
      const r = validateAgentOutput('headTrader', raw);
      expect(r.ok).toBe(true);
    });

    it('rejects invalid action value', () => {
      const raw = JSON.stringify({ action: 'PANIC', conviction: 0.7 });
      const r = validateAgentOutput('headTrader', raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/action/);
    });

    it('rejects missing conviction', () => {
      const raw = JSON.stringify({ action: 'BUY' });
      const r = validateAgentOutput('headTrader', raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/conviction/);
    });

    it('rejects conviction outside 0..1', () => {
      const raw = JSON.stringify({ action: 'BUY', conviction: 1.2 });
      const r = validateAgentOutput('headTrader', raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/conviction/);
    });
  });

  describe('critic', () => {
    it('accepts a valid critic output', () => {
      const raw = JSON.stringify({
        severity: 'warn',
        body: 'Head trader over-weighted momentum despite RSI divergence.',
        tags: ['overweight_momentum'],
      });
      const r = validateAgentOutput('critic', raw);
      expect(r.ok).toBe(true);
    });

    it('rejects invalid severity', () => {
      const raw = JSON.stringify({
        severity: 'meh',
        body: 'Long enough to clear min',
        tags: [],
      });
      const r = validateAgentOutput('critic', raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/severity/);
    });

    it('rejects too-short body', () => {
      const raw = JSON.stringify({ severity: 'info', body: 'too short' });
      const r = validateAgentOutput('critic', raw);
      expect(r.ok).toBe(false);
    });
  });

  describe('generic failure modes', () => {
    it('returns a JSON parse error for non-JSON input', () => {
      const r = validateAgentOutput('momentum', 'this is not json at all');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/JSON parse failed/);
    });

    it('returns Unknown agent for an unregistered name', () => {
      const r = validateAgentOutput('mysteryAgent', '{}');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Unknown agent/);
    });
  });
});

describe('agent-outputs.outputContractFor', () => {
  it('returns a non-empty REQUIRED OUTPUT block for every registered agent', () => {
    for (const name of ALL_AGENT_NAMES) {
      const contract = outputContractFor(name);
      expect(contract).toContain('REQUIRED OUTPUT');
      expect(contract.length).toBeGreaterThan(50);
    }
  });

  it('hasContract is true for every registered agent', () => {
    for (const name of ALL_AGENT_NAMES) {
      expect(hasContract(name)).toBe(true);
    }
  });

  it('hasContract is false for an unknown agent', () => {
    expect(hasContract('mysteryAgent')).toBe(false);
  });

  it('every contract entry has a paired Zod schema', () => {
    // The Phase 2 invariant: contract + schema are co-located so they
    // can't drift. If you add a new contract you must also export a schema.
    for (const name of ALL_AGENT_NAMES) {
      expect(schemaFor(name)).not.toBeNull();
    }
  });
});
