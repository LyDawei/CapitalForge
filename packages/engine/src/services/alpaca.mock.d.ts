import { AlpacaService } from './alpaca';
import { DailyBar, AlpacaOrder, AlpacaPosition } from '../types';
export declare class MockAlpacaService implements AlpacaService {
    private orderCounter;
    private orders;
    private position;
    getBarsAfter(symbol: string, fromDate: string, limit: number): Promise<DailyBar[]>;
    getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
    submitOrder(symbol: string, qty: number, side: 'buy' | 'sell'): Promise<AlpacaOrder>;
    getOrder(orderId: string): Promise<AlpacaOrder>;
    getPositions(): Promise<AlpacaPosition[]>;
    getCurrentPrice(symbol: string): number;
    reset(): void;
    private updatePosition;
}
export declare function createMockAlpacaService(): AlpacaService;
//# sourceMappingURL=alpaca.mock.d.ts.map