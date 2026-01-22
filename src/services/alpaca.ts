import { Config } from '../config';
import { DailyBar, AlpacaOrder } from '../types';

export interface AlpacaService {
  getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
  submitOrder(
    symbol: string,
    qty: number,
    side: 'buy' | 'sell'
  ): Promise<AlpacaOrder>;
  getOrder(orderId: string): Promise<AlpacaOrder>;
}

interface AlpacaBarResponse {
  bars: {
    [symbol: string]: Array<{
      t: string; // timestamp
      o: number; // open
      h: number; // high
      l: number; // low
      c: number; // close
      v: number; // volume
    }>;
  };
}

interface AlpacaOrderResponse {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  status: string;
  created_at: string;
  filled_at: string | null;
}

export class RealAlpacaService implements AlpacaService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private dataBaseUrl: string;

  constructor(config: Config) {
    this.apiKey = config.alpacaApiKey;
    this.apiSecret = config.alpacaApiSecret;
    this.baseUrl = config.alpacaBaseUrl;
    // Data API is separate from trading API
    this.dataBaseUrl = 'https://data.alpaca.markets';
  }

  private getHeaders(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.apiSecret,
      'Content-Type': 'application/json',
    };
  }

  async getDailyBars(symbol: string, limit: number): Promise<DailyBar[]> {
    // Calculate the start date (we need enough historical data)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Math.ceil(limit * 1.5)); // Extra buffer for weekends/holidays

    const params = new URLSearchParams({
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
      timeframe: '1Day',
      limit: limit.toString(),
    });

    const url = `${this.dataBaseUrl}/v2/stocks/${symbol}/bars?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Alpaca API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as AlpacaBarResponse;
    const bars = data.bars[symbol] || [];

    return bars.map((bar) => ({
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  }

  async submitOrder(
    symbol: string,
    qty: number,
    side: 'buy' | 'sell'
  ): Promise<AlpacaOrder> {
    const url = `${this.baseUrl}/v2/orders`;

    const body = {
      symbol,
      qty: qty.toString(),
      side,
      type: 'market',
      time_in_force: 'day',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Alpaca order submission error: ${response.status} - ${error}`);
    }

    const order = (await response.json()) as AlpacaOrderResponse;
    return this.mapOrderResponse(order);
  }

  async getOrder(orderId: string): Promise<AlpacaOrder> {
    const url = `${this.baseUrl}/v2/orders/${orderId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Alpaca order fetch error: ${response.status} - ${error}`);
    }

    const order = (await response.json()) as AlpacaOrderResponse;
    return this.mapOrderResponse(order);
  }

  private mapOrderResponse(order: AlpacaOrderResponse): AlpacaOrder {
    return {
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      qty: parseFloat(order.qty),
      filledQty: parseFloat(order.filled_qty) || undefined,
      filledAvgPrice: order.filled_avg_price
        ? parseFloat(order.filled_avg_price)
        : undefined,
      status: order.status,
      createdAt: order.created_at,
      filledAt: order.filled_at || undefined,
    };
  }
}

export function createAlpacaService(config: Config): AlpacaService {
  return new RealAlpacaService(config);
}
