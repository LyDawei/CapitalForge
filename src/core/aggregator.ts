import { AgentOutput, Decision, AggregationResult } from '../types';

/**
 * Aggregate agent evaluations into a single decision
 * Pure function with division-by-zero safeguard
 *
 * Decision thresholds:
 * - weightedScore > 0.4 = BUY
 * - weightedScore < -0.4 = SELL
 * - else = HOLD
 */
export function aggregate(evaluations: AgentOutput[]): AggregationResult {
  if (evaluations.length === 0) {
    return { weightedScore: 0, decision: 'HOLD' };
  }

  const totalWeight = evaluations.reduce((sum, e) => sum + e.confidence, 0);

  // SAFEGUARD: If total confidence is 0, return neutral HOLD
  if (totalWeight === 0) {
    return { weightedScore: 0, decision: 'HOLD' };
  }

  const weightedScore =
    evaluations.reduce((sum, e) => sum + e.bullishScore * e.confidence, 0) /
    totalWeight;

  let decision: Decision = 'HOLD';
  if (weightedScore > 0.4) {
    decision = 'BUY';
  } else if (weightedScore < -0.4) {
    decision = 'SELL';
  }

  return { weightedScore, decision };
}

/**
 * Format aggregation result for logging
 */
export function formatAggregationResult(result: AggregationResult): string {
  return `Decision: ${result.decision} (weighted score: ${result.weightedScore.toFixed(3)})`;
}

/**
 * Get decision explanation based on weighted score
 */
export function getDecisionExplanation(weightedScore: number): string {
  if (weightedScore > 0.4) {
    return `Strong bullish consensus (score: ${weightedScore.toFixed(3)} > 0.4 threshold)`;
  } else if (weightedScore < -0.4) {
    return `Strong bearish consensus (score: ${weightedScore.toFixed(3)} < -0.4 threshold)`;
  } else if (weightedScore > 0) {
    return `Weak bullish signal, insufficient for action (score: ${weightedScore.toFixed(3)})`;
  } else if (weightedScore < 0) {
    return `Weak bearish signal, insufficient for action (score: ${weightedScore.toFixed(3)})`;
  } else {
    return 'Neutral - no clear directional bias';
  }
}
