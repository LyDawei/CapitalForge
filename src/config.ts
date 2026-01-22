import { z } from 'zod';

const ConfigSchema = z.object({
  // Database
  databaseUrl: z.string().url(),

  // Alpaca API
  alpacaApiKey: z.string().min(1),
  alpacaApiSecret: z.string().min(1),
  alpacaBaseUrl: z.string().url(),

  // Anthropic API
  anthropicApiKey: z.string().min(1),

  // Trading Configuration
  tradingSymbol: z.string().min(1).default('SPY'),
  allocatedCapital: z.number().positive().default(200),
  positionSizePct: z.number().min(0).max(1).default(0.2),
  maxDrawdownPct: z.number().min(0).max(1).default(0.2),

  // LLM Configuration
  llmModel: z.string().default('claude-3-5-sonnet-20241022'),
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

export function loadConfig(): Config {
  const rawConfig = {
    databaseUrl: process.env.DATABASE_URL,
    alpacaApiKey: process.env.ALPACA_API_KEY,
    alpacaApiSecret: process.env.ALPACA_API_SECRET,
    alpacaBaseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    tradingSymbol: process.env.TRADING_SYMBOL || 'SPY',
    allocatedCapital: parseNumber(process.env.ALLOCATED_CAPITAL, 200),
    positionSizePct: parseNumber(process.env.POSITION_SIZE_PCT, 0.2),
    maxDrawdownPct: parseNumber(process.env.MAX_DRAWDOWN_PCT, 0.2),
    llmModel: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022',
    llmTemperature: parseNumber(process.env.LLM_TEMPERATURE, 0.2),
    cronSchedule: process.env.CRON_SCHEDULE || '35 9 * * 1-5',
    mode: (process.env.MODE || 'mock') as 'mock' | 'paper',
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('Configuration validation failed:');
    console.error(result.error.format());
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
