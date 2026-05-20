import * as path from 'path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

// Load the V2-local .env (sibling to package.json's parent dir = V2 root).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:4001'),

  ALPACA_API_KEY: z.string().default(''),
  ALPACA_API_SECRET: z.string().default(''),
  ALPACA_BASE_URL: z.string().default('https://paper-api.alpaca.markets'),
  ALPACA_DATA_URL: z.string().default('https://data.alpaca.markets'),
  /// Free-tier data feed. SIP requires a paid subscription; IEX is the safe default.
  ALPACA_DATA_FEED: z.enum(['iex', 'sip']).default('iex'),
  /// Soft cap for the in-process token bucket. Alpaca free tier is 200/min;
  /// we leave headroom for any concurrent processes hitting the same key.
  ALPACA_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(180),

  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'mock']).default('mock'),
  LLM_MODEL: z.string().default('gpt-4o'),
  LLM_TEMPERATURE: z.coerce.number().default(0.2),
  OPENAI_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),

  /// FRED — Federal Reserve Economic Data. Free, registration only at
  /// https://fred.stlouisfed.org/docs/api/api_key.html. Powers macroContext.
  FRED_API_KEY: z.string().default(''),
  /// Finnhub — earnings calendar, company news, economic calendar. Free tier
  /// is 60 req/min. Register at https://finnhub.io/dashboard.
  FINNHUB_API_KEY: z.string().default(''),
  FINNHUB_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(50),

  MODE: z.enum(['mock', 'paper']).default('mock'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
