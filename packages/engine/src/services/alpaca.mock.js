"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockAlpacaService = void 0;
exports.createMockAlpacaService = createMockAlpacaService;
// Deterministic mock data for testing
// Generates consistent data based on symbol and date
/**
 * Deterministic bar generator. The price/volume formulas key off the symbol's base price plus
 * a per-symbol "epoch" so two callers asking for adjacent date ranges produce a continuous series.
 *
 * `epochOffset` = days since 1970-01-01. Same date → same bar values, regardless of caller.
 */
function buildBarForEpoch(symbol, epochDay, date) {
    const basePrice = getBasePrice(symbol);
    const variation = Math.sin(epochDay * 0.5) * 0.02;
    const trend = epochDay * 0.0001;
    const price = basePrice * (1 + variation + trend);
    const baseVolume = 1000000;
    const volumeMultiplier = 1 + (date.getDay() - 3) * 0.1;
    return {
        timestamp: date.toISOString(),
        open: price * 0.999,
        high: price * 1.01,
        low: price * 0.99,
        close: price,
        volume: Math.floor(baseVolume * volumeMultiplier),
    };
}
function epochDaysFor(date) {
    return Math.floor(date.getTime() / 86_400_000);
}
function generateDeterministicBars(symbol, limit) {
    const bars = [];
    // Oversample calendar days so we have at least `limit` trading days after skipping weekends.
    const calendarDays = Math.ceil(limit * 1.5) + 10;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - calendarDays);
    for (let i = 0; i < calendarDays; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        if (date.getDay() === 0 || date.getDay() === 6)
            continue;
        bars.push(buildBarForEpoch(symbol, epochDaysFor(date), date));
    }
    return bars.slice(-limit);
}
function generateBarsAfter(symbol, fromDate, limit) {
    const bars = [];
    const start = new Date(fromDate);
    start.setDate(start.getDate() + 1);
    // Walk forward until we have `limit` trading days.
    let cursor = new Date(start);
    while (bars.length < limit) {
        if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
            bars.push(buildBarForEpoch(symbol, epochDaysFor(cursor), new Date(cursor)));
        }
        cursor.setDate(cursor.getDate() + 1);
        // Safety stop — never walk more than ~3× requested calendar days
        if (epochDaysFor(cursor) - epochDaysFor(start) > limit * 3 + 30)
            break;
    }
    return bars;
}
function getBasePrice(symbol) {
    // Deterministic base price based on symbol
    const symbolPrices = {
        SPY: 450,
        QQQ: 380,
        AAPL: 175,
        MSFT: 400,
        GOOGL: 140,
    };
    return symbolPrices[symbol] || 100;
}
class MockAlpacaService {
    orderCounter = 0;
    orders = new Map();
    position = null;
    async getBarsAfter(symbol, fromDate, limit) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return generateBarsAfter(symbol, fromDate, limit);
    }
    async getDailyBars(symbol, limit) {
        // Simulate slight network delay (deterministic)
        await new Promise((resolve) => setTimeout(resolve, 10));
        return generateDeterministicBars(symbol, limit);
    }
    async submitOrder(symbol, qty, side) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.orderCounter++;
        const orderId = `mock-order-${this.orderCounter.toString().padStart(6, '0')}`;
        // Get current price for the symbol
        const bars = await this.getDailyBars(symbol, 1);
        const currentPrice = bars.length > 0 ? bars[bars.length - 1].close : getBasePrice(symbol);
        const order = {
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
        this.updatePosition(symbol, qty, side, currentPrice);
        this.orders.set(orderId, order);
        return order;
    }
    async getOrder(orderId) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const order = this.orders.get(orderId);
        if (!order) {
            throw new Error(`Order not found: ${orderId}`);
        }
        return order;
    }
    async getPositions() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return this.position ? [this.position] : [];
    }
    // For testing - get current mock price
    getCurrentPrice(symbol) {
        return getBasePrice(symbol);
    }
    // For testing - reset state
    reset() {
        this.orderCounter = 0;
        this.orders.clear();
        this.position = null;
    }
    updatePosition(symbol, qty, side, fillPrice) {
        const signedQty = side === 'buy' ? qty : -qty;
        if (!this.position) {
            if (side === 'sell') {
                // No position to sell in mock; ignore.
                return;
            }
            this.position = {
                symbol,
                qty: qty,
                avgEntryPrice: fillPrice,
                currentPrice: fillPrice,
                marketValue: qty * fillPrice,
                costBasis: qty * fillPrice,
                side: 'long',
            };
            return;
        }
        if (this.position.symbol !== symbol) {
            // Enforce single-position constraint in mock
            return;
        }
        const newQty = this.position.qty + signedQty;
        if (newQty <= 0) {
            this.position = null;
            return;
        }
        if (side === 'buy') {
            const previousCost = this.position.qty * this.position.avgEntryPrice;
            const addedCost = qty * fillPrice;
            const totalCost = previousCost + addedCost;
            this.position.avgEntryPrice = totalCost / newQty;
        }
        this.position.qty = newQty;
        this.position.currentPrice = fillPrice;
        this.position.marketValue = newQty * fillPrice;
        this.position.costBasis = this.position.avgEntryPrice * newQty;
        this.position.side = 'long';
    }
}
exports.MockAlpacaService = MockAlpacaService;
function createMockAlpacaService() {
    return new MockAlpacaService();
}
//# sourceMappingURL=alpaca.mock.js.map