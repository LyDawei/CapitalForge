import { TechnicalData, SandboxContext, AgentName } from './types';

// Prompt versions for tracking
export const PROMPT_VERSIONS: Record<AgentName, string> = {
  momentum: 'v1.0.0',
  meanReversion: 'v1.0.0',
  confirmation: 'v1.0.0',
};

// Agent type descriptions
const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  momentum:
    'momentum technical analyst. You evaluate trend strength and direction, focusing on whether the current price movement has strong momentum behind it.',
  meanReversion:
    'mean reversion technical analyst. You evaluate whether the price has extended too far from its average and is likely to revert. You look for overbought/oversold conditions and overextension signals.',
  confirmation:
    'confirmation technical analyst. You cross-validate signals from other indicators, looking for confluence between MACD, moving average crossovers, and volume to confirm the overall signal strength.',
};

// Format position summary for prompt
function formatPositionSummary(sandbox: SandboxContext): string {
  if (sandbox.positionQty === 0) {
    return 'No current position (flat)';
  }
  return `Holding ${sandbox.positionQty} shares of ${sandbox.positionSymbol} at avg price $${sandbox.positionAvgPrice?.toFixed(2)}`;
}

// Format number with appropriate precision
function formatNumber(value: number, decimals: number = 2): string {
  return value.toFixed(decimals);
}

// Format large numbers with commas
function formatVolume(volume: number): string {
  return volume.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Build the prompt for an agent
 */
export function buildPrompt(
  agentName: AgentName,
  data: TechnicalData,
  sandbox: SandboxContext
): string {
  const agentDescription = AGENT_DESCRIPTIONS[agentName];
  const positionSummary = formatPositionSummary(sandbox);

  return `You are a ${agentDescription}

TECHNICAL DATA:
- Date: ${data.date}
- Close: $${formatNumber(data.close)}
- RSI(14): ${formatNumber(data.rsi)}
- SMA(20): $${formatNumber(data.sma20)}
- SMA(50): $${formatNumber(data.sma50)}
- MACD Histogram: ${formatNumber(data.macdHistogram, 4)}
- Volume: ${formatVolume(data.volume)} (30-day avg: ${formatVolume(data.avgVolume)})

CURRENT POSITION:
${positionSummary}

SANDBOX:
- Allocated: $${formatNumber(sandbox.allocatedCapital)}
- Equity: $${formatNumber(sandbox.currentEquity)}
- Drawdown: ${formatNumber(sandbox.drawdownPct * 100)}%

Analyze the technical data from your perspective as a ${agentName} analyst and provide your assessment.

Respond with JSON only:
{
  "bullishScore": <number from -1 (very bearish) to +1 (very bullish)>,
  "confidence": <number from 0 (no confidence) to 1 (high confidence)>,
  "rationale": ["reason1", "reason2", "reason3"]
}`;
}

/**
 * Get the prompt template (without data filled in) for storage
 */
export function getPromptTemplate(agentName: AgentName): string {
  const agentDescription = AGENT_DESCRIPTIONS[agentName];

  return `You are a ${agentDescription}

TECHNICAL DATA:
- Date: {date}
- Close: ${'{close}'}
- RSI(14): {rsi}
- SMA(20): ${'{sma20}'}
- SMA(50): ${'{sma50}'}
- MACD Histogram: {macdHistogram}
- Volume: {volume} (30-day avg: {avgVolume})

CURRENT POSITION:
{positionSummary}

SANDBOX:
- Allocated: ${'{allocatedCapital}'}
- Equity: ${'{currentEquity}'}
- Drawdown: {drawdownPct}%

Analyze the technical data from your perspective as a ${agentName} analyst and provide your assessment.

Respond with JSON only:
{
  "bullishScore": <number from -1 (very bearish) to +1 (very bullish)>,
  "confidence": <number from 0 (no confidence) to 1 (high confidence)>,
  "rationale": ["reason1", "reason2", "reason3"]
}`;
}
