"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealAlpacaService = void 0;
exports.createAlpacaService = createAlpacaService;
class RealAlpacaService {
    apiKey;
    apiSecret;
    baseUrl;
    dataBaseUrl;
    constructor(config) {
        this.apiKey = config.alpacaApiKey;
        this.apiSecret = config.alpacaApiSecret;
        this.baseUrl = config.alpacaBaseUrl;
        // Data API is separate from trading API
        this.dataBaseUrl = 'https://data.alpaca.markets';
    }
    getHeaders() {
        return {
            'APCA-API-KEY-ID': this.apiKey,
            'APCA-API-SECRET-KEY': this.apiSecret,
            'Content-Type': 'application/json',
        };
    }
    async getDailyBars(symbol, limit) {
        // Calculate the start date (we need enough historical data)
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 1); // Yesterday
        // Skip weekends
        while (endDate.getDay() === 0 || endDate.getDay() === 6) {
            endDate.setDate(endDate.getDate() - 1);
        }
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - Math.ceil(limit * 1.5)); // Extra buffer for weekends/holidays
        const params = new URLSearchParams({
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
            timeframe: '1Day',
            limit: limit.toString(),
            feed: 'iex'
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
        const data = (await response.json());
        const bars = data.bars || [];
        return bars.map((bar) => ({
            timestamp: bar.t,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
        }));
    }
    async getBarsAfter(symbol, fromDate, limit) {
        // Strictly after fromDate. We add 1 day to the start to skip the cycle date itself.
        const start = new Date(fromDate);
        start.setDate(start.getDate() + 1);
        const end = new Date(start);
        end.setDate(end.getDate() + Math.ceil(limit * 1.5) + 5);
        const params = new URLSearchParams({
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
            timeframe: '1Day',
            limit: limit.toString(),
            feed: 'iex',
        });
        const url = `${this.dataBaseUrl}/v2/stocks/${symbol}/bars?${params}`;
        const response = await fetch(url, { method: 'GET', headers: this.getHeaders() });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Alpaca API error: ${response.status} - ${error}`);
        }
        const data = (await response.json());
        return (data.bars || []).slice(0, limit).map((bar) => ({
            timestamp: bar.t,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
        }));
    }
    async submitOrder(symbol, qty, side) {
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
        const order = (await response.json());
        return this.mapOrderResponse(order);
    }
    async getOrder(orderId) {
        const url = `${this.baseUrl}/v2/orders/${orderId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Alpaca order fetch error: ${response.status} - ${error}`);
        }
        const order = (await response.json());
        return this.mapOrderResponse(order);
    }
    async getPositions() {
        const url = `${this.baseUrl}/v2/positions`;
        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Alpaca positions fetch error: ${response.status} - ${error}`);
        }
        const positions = (await response.json());
        return positions.map((position) => this.mapPositionResponse(position));
    }
    mapOrderResponse(order) {
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
    mapPositionResponse(position) {
        return {
            symbol: position.symbol,
            qty: parseFloat(position.qty),
            avgEntryPrice: parseFloat(position.avg_entry_price),
            currentPrice: position.current_price ? parseFloat(position.current_price) : undefined,
            marketValue: position.market_value ? parseFloat(position.market_value) : undefined,
            costBasis: position.cost_basis ? parseFloat(position.cost_basis) : undefined,
            side: position.side,
        };
    }
}
exports.RealAlpacaService = RealAlpacaService;
function createAlpacaService(config) {
    return new RealAlpacaService(config);
}
//# sourceMappingURL=alpaca.js.map