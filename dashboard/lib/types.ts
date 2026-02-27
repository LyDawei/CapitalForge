export interface TechnicalData {
  symbol: string;
  date: string;
  close: number;
  rsi: number;
  sma20: number;
  sma50: number;
  macdHistogram: number;
  volume: number;
  avgVolume: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  cash: number;
  drawdown: number;
  positionSymbol: string | null;
  positionQty: number;
}
