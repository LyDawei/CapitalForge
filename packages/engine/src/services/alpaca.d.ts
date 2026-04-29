import { Config } from '../config';
import { DailyBar, AlpacaOrder, AlpacaPosition } from '../types';
export interface AlpacaService {
    getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
    /**
     * Returns up to `limit` daily bars whose date is strictly after `fromDate` (YYYY-MM-DD).
     * Used by the settlement simulator to walk a TradePlan forward and detect stop/target hits.
     */
    getBarsAfter(symbol: string, fromDate: string, limit: number): Promise<DailyBar[]>;
    submitOrder(symbol: string, qty: number, side: 'buy' | 'sell'): Promise<AlpacaOrder>;
    getOrder(orderId: string): Promise<AlpacaOrder>;
    getPositions(): Promise<AlpacaPosition[]>;
}
export declare class RealAlpacaService implements AlpacaService {
    private apiKey;
    private apiSecret;
    private baseUrl;
    private dataBaseUrl;
    constructor(config: Config);
    private getHeaders;
    getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
    getBarsAfter(symbol: string, fromDate: string, limit: number): Promise<DailyBar[]>;
    submitOrder(symbol: string, qty: number, side: 'buy' | 'sell'): Promise<AlpacaOrder>;
    getOrder(orderId: string): Promise<AlpacaOrder>;
    getPositions(): Promise<AlpacaPosition[]>;
    private mapOrderResponse;
    private mapPositionResponse;
}
export declare function createAlpacaService(config: Config): AlpacaService;
//# sourceMappingURL=alpaca.d.ts.map