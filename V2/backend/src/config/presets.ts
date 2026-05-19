/**
 * Risk + strategy presets. Plain objects, no DB dependency — the API copies
 * them into a new RiskConfig / StrategyConfig row when applied.
 *
 * Each preset includes a `description` that the Settings UI uses to explain
 * what the user is signing up for. Targeted at someone new to swing trading.
 */

export interface RiskPreset {
  name: 'conservative' | 'balanced' | 'aggressive';
  displayName: string;
  description: string;
  values: {
    riskTolerancePct: number;
    maxRiskPctPerTrade: number;
    maxConcurrentPositions: number;
    drawdownHalveAt: number;
    drawdownCloseOnlyAt: number;
    drawdownHardHaltAt: number;
    defaultStopLossPct: number;
    defaultTarget1R: number;
    defaultTarget2R: number;
    defaultTimeStopBars: number;
  };
}

export const RISK_PRESETS: RiskPreset[] = [
  {
    name: 'conservative',
    displayName: 'Conservative',
    description:
      'Smaller positions, tighter loss limits, fewer concurrent trades. Designed for capital preservation — slower equity curve, smaller drawdowns. Good when you are still building trust in the agents.',
    values: {
      riskTolerancePct: 0.7,
      maxRiskPctPerTrade: 0.01,
      maxConcurrentPositions: 2,
      drawdownHalveAt: 0.07,
      drawdownCloseOnlyAt: 0.10,
      drawdownHardHaltAt: 0.15,
      defaultStopLossPct: 0.04,
      defaultTarget1R: 2.0,
      defaultTarget2R: 3.5,
      defaultTimeStopBars: 8,
    },
  },
  {
    name: 'balanced',
    displayName: 'Balanced',
    description:
      'Industry-standard 2% per-trade risk cap. Up to 3 concurrent positions. Standard drawdown ladder. Reasonable default if you are unsure.',
    values: {
      riskTolerancePct: 1.0,
      maxRiskPctPerTrade: 0.02,
      maxConcurrentPositions: 3,
      drawdownHalveAt: 0.10,
      drawdownCloseOnlyAt: 0.15,
      drawdownHardHaltAt: 0.20,
      defaultStopLossPct: 0.05,
      defaultTarget1R: 1.6,
      defaultTarget2R: 3.2,
      defaultTimeStopBars: 10,
    },
  },
  {
    name: 'aggressive',
    displayName: 'Aggressive',
    description:
      'Larger per-trade risk (3%), more concurrent positions (5), wider drawdown tolerance. Higher upside but a string of losses hurts faster. Only use after you have meaningful agent prediction data and trust their edge.',
    values: {
      riskTolerancePct: 1.3,
      maxRiskPctPerTrade: 0.03,
      maxConcurrentPositions: 5,
      drawdownHalveAt: 0.15,
      drawdownCloseOnlyAt: 0.20,
      drawdownHardHaltAt: 0.25,
      defaultStopLossPct: 0.06,
      defaultTarget1R: 1.4,
      defaultTarget2R: 2.8,
      defaultTimeStopBars: 12,
    },
  },
];

export interface StrategyPreset {
  name: 'trend_following' | 'mean_reversion' | 'balanced';
  displayName: string;
  description: string;
  bias: 'trend_following' | 'mean_reversion' | 'balanced';
  promptDirective: string;
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    name: 'trend_following',
    displayName: 'Trend Following',
    description:
      'Bias toward stocks already moving in a clear direction with momentum. Head trader weights trendRegime, momentum, and setupPattern more heavily. Misses early reversals but catches sustained moves. Best in trending markets.',
    bias: 'trend_following',
    promptDirective:
      'STRATEGY BIAS: trend-following. Weight trendRegime, momentum, and setupPattern specialists most heavily. Prefer setups in bull_trending regime with accelerating or steady momentum. Lower conviction when meanReversion flags overbought/oversold counter-signals.',
  },
  {
    name: 'mean_reversion',
    displayName: 'Mean Reversion',
    description:
      'Bias toward stocks that have moved too far from their average and are likely to revert. Head trader weights meanReversion and volumeFlow more heavily. Misses sustained trends but catches snapback rallies. Best in choppy/sideways markets.',
    bias: 'mean_reversion',
    promptDirective:
      'STRATEGY BIAS: mean-reversion. Weight meanReversion, volumeFlow, and setupPattern (failed_breakdown, mean_reversion_oversold) most heavily. Prefer setups where extensionATR > 1.5 and revertProbability > 0.6. Be skeptical of breakout_continuation in already-extended moves.',
  },
  {
    name: 'balanced',
    displayName: 'Balanced',
    description:
      'No bias — head trader weights all specialists equally. Default behavior. Recommended until you have hit-rate data showing one bias outperforms.',
    bias: 'balanced',
    promptDirective:
      'STRATEGY BIAS: balanced. Weight all specialists equally. Take the strongest setups regardless of whether they are continuation or reversion plays.',
  },
];

export function getRiskPreset(name: string): RiskPreset | undefined {
  return RISK_PRESETS.find((p) => p.name === name);
}

export function getStrategyPreset(name: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.name === name);
}
