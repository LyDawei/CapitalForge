import { RSI, SMA, MACD } from 'technicalindicators';
import { DailyBar, TechnicalData, formatDate } from '../types';

export interface TechnicalConfig {
  rsiPeriod: number;
  sma20Period: number;
  sma50Period: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  avgVolumePeriod: number;
}

export const DEFAULT_TECHNICAL_CONFIG: TechnicalConfig = {
  rsiPeriod: 14,
  sma20Period: 20,
  sma50Period: 50,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  avgVolumePeriod: 30,
};

export function calculateTechnicals(
  bars: DailyBar[],
  symbol: string,
  config: TechnicalConfig = DEFAULT_TECHNICAL_CONFIG
): TechnicalData {
  if (bars.length < config.sma50Period) {
    throw new Error(
      `Insufficient data: need at least ${config.sma50Period} bars, got ${bars.length}`
    );
  }

  // Extract close prices and volumes
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  // Calculate RSI
  const rsiValues = RSI.calculate({
    values: closes,
    period: config.rsiPeriod,
  });
  const rsi = rsiValues[rsiValues.length - 1];

  // Calculate SMA20
  const sma20Values = SMA.calculate({
    values: closes,
    period: config.sma20Period,
  });
  const sma20 = sma20Values[sma20Values.length - 1];

  // Calculate SMA50
  const sma50Values = SMA.calculate({
    values: closes,
    period: config.sma50Period,
  });
  const sma50 = sma50Values[sma50Values.length - 1];

  // Calculate MACD
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: config.macdFast,
    slowPeriod: config.macdSlow,
    signalPeriod: config.macdSignal,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macdLatest = macdValues[macdValues.length - 1];
  const macdHistogram = macdLatest?.histogram ?? 0;

  // Current volume and average volume
  const volume = volumes[volumes.length - 1];
  const avgVolumeBars = volumes.slice(-config.avgVolumePeriod);
  const avgVolume =
    avgVolumeBars.reduce((sum, v) => sum + v, 0) / avgVolumeBars.length;

  // Latest bar info
  const latestBar = bars[bars.length - 1];
  const close = latestBar.close;
  const date = formatDate(new Date(latestBar.timestamp));

  return {
    symbol,
    date,
    close,
    rsi,
    sma20,
    sma50,
    macdHistogram,
    volume,
    avgVolume,
  };
}

// Helper to get the minimum number of bars needed
export function getMinimumBarsRequired(
  config: TechnicalConfig = DEFAULT_TECHNICAL_CONFIG
): number {
  // MACD needs slowPeriod + signalPeriod - 1 bars to produce first value
  // We need some extra for RSI and SMA calculations
  const macdMinimum = config.macdSlow + config.macdSignal;
  return Math.max(config.sma50Period, macdMinimum, config.avgVolumePeriod) + 10;
}
