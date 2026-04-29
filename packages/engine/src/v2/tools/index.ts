import { ToolRegistry } from './registry';
import { getIndicator, getAtrStopSuggestion } from './indicators';
import { getMarketRegime, getSectorPerformance, getRelativeStrength } from './market';
import { getRecentNews, getEarningsCalendar } from './news';
import { getCorrelations, getPositionHistory } from './portfolio';
import { submitDecision, SubmitDecisionArgsSchema } from './submit';

export * from './types';
export * from './registry';
export { SubmitDecisionArgsSchema };

export function buildHeadTraderToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(getMarketRegime)
    .register(getIndicator)
    .register(getAtrStopSuggestion)
    .register(getSectorPerformance)
    .register(getRelativeStrength)
    .register(getRecentNews)
    .register(getEarningsCalendar)
    .register(getPositionHistory)
    .register(getCorrelations)
    .register(submitDecision);
}

export const TOOL_REGISTRY_VERSION = 'v2.tools.0.1.0';
