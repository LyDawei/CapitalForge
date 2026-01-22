import { AlpacaService } from './alpaca';
import { DailyBar, AlpacaOrder } from '../types';

// Deterministic mock data for testing
// Generates consistent data based on symbol and date

function generateDeterministicBars(symbol: string, limit: number): DailyBar[] {
  const bars: DailyBar[] = [];
  const basePrice = getBasePrice(symbol);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - limit);

  for (let i = 0; i < limit; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) {
      continue;
    }

    // Deterministic price variation based on index
    const variation = Math.sin(i * 0.5) * 0.02; // ±2% oscillation
    const trend = i * 0.001; // Slight upward trend
    const price = basePrice * (1 + variation + trend);

    // Deterministic volume based on day of week
    const baseVolume = 1000000;
    const volumeMultiplier = 1 + (date.getDay() - 3) * 0.1; // More volume mid-week

    bars.push({
      timestamp: date.toISOString(),
      open: price * 0.999,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: Math.floor(baseVolume * volumeMultiplier),
    });
  }

  // Return most recent bars last
  return bars.slice(-limit);
}

function getBasePrice(symbol: string): number {
  // Deterministic base price based on symbol
  const symbolPrices: Record<string, number> = {
    SPY: 450,
    QQQ: 380,
    AAPL: 175,
    MSFT: 400,
    GOOGL: 140,
  };
  return symbolPrices[symbol] || 100;
}

export class MockAlpacaService implements AlpacaService {
  private orderCounter = 0;
  private orders: Map<string, AlpacaOrder> = new Map();

  async getDailyBars(symbol: string, limit: number): Promise<DailyBar[]> {
    // Simulate slight network delay (deterministic)
    await new Promise((resolve) => setTimeout(resolve, 10));
    return generateDeterministicBars(symbol, limit);
  }

  async submitOrder(
    symbol: string,
    qty: number,
    side: 'buy' | 'sell'
  ): Promise<AlpacaOrder> {
    await new Promise((resolve) => setTimeout(resolve, 10));

    this.orderCounter++;
    const orderId = `mock-order-${this.orderCounter.toString().padStart(6, '0')}`;

    // Get current price for the symbol
    const bars = await this.getDailyBars(symbol, 1);
    const currentPrice = bars.length > 0 ? bars[bars.length - 1].close : getBasePrice(symbol);

    const order: AlpacaOrder = {
      id: orderId,
      symbol,
      side,
      qty,
      filledQty: qty,
      filledAvgPrice: currentPrice,
      status: 'filled',
      createdAt: new Date().toISOString(),
      filledAt: new Date().toISOString(),
    };

    this.orders.set(orderId, order);
    return order;
  }

  async getOrder(orderId: string): Promise<AlpacaOrder> {
    await new Promise((resolve) => setTimeout(resolve, 10));

    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    return order;
  }

  // For testing - get current mock price
  getCurrentPrice(symbol: string): number {
    return getBasePrice(symbol);
  }

  // For testing - reset state
  reset(): void {
    this.orderCounter = 0;
    this.orders.clear();
  }
}

export function createMockAlpacaService(): AlpacaService {
  return new MockAlpacaService();
}
