import { z } from 'zod';

const ConfigSchema = z.object({
  // Database
  databaseUrl: z.string().url(),

  // Alpaca API
  alpacaApiKey: z.string().min(1),
  alpacaApiSecret: z.string().min(1),
  alpacaBaseUrl: z.string().url(),

  // OpenAI API
  openaiApiKey: z.string().min(1),

  // Trading Configuration
  tradingSymbol: z.string().min(1).default('SPY'), // Deprecated: use tradingSymbols instead
  tradingSymbols: z.array(z.string().min(1)).default(['SPY']),
  allocatedCapital: z.number().positive().default(2000),
  positionSizePct: z.number().min(0).max(1).default(0.2),
  maxDrawdownPct: z.number().min(0).max(1).default(0.2),

  // LLM Configuration
  llmModel: z.string().default('gpt-4o'),
  llmTemperature: z.number().min(0).max(1).default(0.2),

  // Scheduler
  cronSchedule: z.string().default('35 9 * * 1-5'),

  // Mode
  mode: z.enum(['mock', 'paper']).default('mock'),
});

export type Config = z.infer<typeof ConfigSchema>;

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseTradingSymbols(): string[] {
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

export function loadConfig(): Config {
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
    mode: (process.env.MODE || 'mock') as 'mock' | 'paper',
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
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// For testing - allows resetting the config
export function resetConfig(): void {
  configInstance = null;
}
