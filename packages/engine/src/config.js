"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.getConfig = getConfig;
exports.resetConfig = resetConfig;
const zod_1 = require("zod");
const ConfigSchema = zod_1.z.object({
    // Database
    databaseUrl: zod_1.z.string().url(),
    // Alpaca API
    alpacaApiKey: zod_1.z.string().min(1),
    alpacaApiSecret: zod_1.z.string().min(1),
    alpacaBaseUrl: zod_1.z.string().url(),
    // OpenAI API
    openaiApiKey: zod_1.z.string().min(1),
    // Trading Configuration
    tradingSymbol: zod_1.z.string().min(1).default('SPY'), // Deprecated: use tradingSymbols instead
    tradingSymbols: zod_1.z.array(zod_1.z.string().min(1)).default(['SPY']),
    allocatedCapital: zod_1.z.number().positive().default(2000),
    positionSizePct: zod_1.z.number().min(0).max(1).default(0.2),
    maxDrawdownPct: zod_1.z.number().min(0).max(1).default(0.2),
    // LLM Configuration
    llmModel: zod_1.z.string().default('gpt-4o'),
    llmTemperature: zod_1.z.number().min(0).max(1).default(0.2),
    // Scheduler
    cronSchedule: zod_1.z.string().default('35 9 * * 1-5'),
    // Mode
    mode: zod_1.z.enum(['mock', 'paper']).default('mock'),
    // Engine version: V1 (legacy parallel agents) or V2 (head trader + specialists).
    // V1 is a transitional baseline scheduled for removal once V2 checks out.
    engineVersion: zod_1.z.enum(['v1', 'v2']).default('v1'),
});
function parseNumber(value, defaultValue) {
    if (value === undefined)
        return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}
function parseTradingSymbols() {
    // Check for TRADING_SYMBOLS first (comma-separated)
    if (process.env.TRADING_SYMBOLS) {
        return process.env.TRADING_SYMBOLS.split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }
    // Fall back to TRADING_SYMBOL for backward compatibility
    if (process.env.TRADING_SYMBOL) {
        return [process.env.TRADING_SYMBOL];
    }
    // Default to SPY
    return ['SPY'];
}
function loadConfig() {
    const tradingSymbols = parseTradingSymbols();
    const tradingSymbol = tradingSymbols[0]; // For backward compatibility
    const rawConfig = {
        databaseUrl: process.env.DATABASE_URL,
        alpacaApiKey: process.env.ALPACA_API_KEY,
        alpacaApiSecret: process.env.ALPACA_API_SECRET,
        alpacaBaseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
        openaiApiKey: process.env.OPENAI_API_KEY,
        tradingSymbol,
        tradingSymbols,
        allocatedCapital: parseNumber(process.env.ALLOCATED_CAPITAL, 2000),
        positionSizePct: parseNumber(process.env.POSITION_SIZE_PCT, 0.2),
        maxDrawdownPct: parseNumber(process.env.MAX_DRAWDOWN_PCT, 0.2),
        llmModel: process.env.LLM_MODEL || 'gpt-4o',
        llmTemperature: parseNumber(process.env.LLM_TEMPERATURE, 0.2),
        cronSchedule: process.env.CRON_SCHEDULE || '35 9 * * 1-5',
        mode: (process.env.MODE || 'mock'),
        engineVersion: (process.env.ENGINE_VERSION || 'v1'),
    };
    const result = ConfigSchema.safeParse(rawConfig);
    if (!result.success) {
        console.error('Configuration validation failed:');
        console.error(JSON.stringify(result.error.format(), null, 2));
        throw new Error('Invalid configuration');
    }
    return result.data;
}
// Singleton config instance
let configInstance = null;
function getConfig() {
    if (!configInstance) {
        configInstance = loadConfig();
    }
    return configInstance;
}
// For testing - allows resetting the config
function resetConfig() {
    configInstance = null;
}
//# sourceMappingURL=config.js.map