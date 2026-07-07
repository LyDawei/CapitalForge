import * as path from 'path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

// Load the V2-local .env (sibling to package.json's parent dir = V2 root).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/// Env booleans arrive as strings. Only "true"/"1" are truthy — `z.coerce.boolean`
/// would treat the string "false" as `true` (any non-empty string is truthy).
const envBool = (def: 'true' | 'false') =>
  z.string().default(def).transform((v) => v.toLowerCase() === 'true' || v === '1');

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:4001'),

  /// In-process daily-cycle scheduler (mirrors V1's built-in cron). OFF by
  /// default so dev/CI never auto-fire real LLM cycles; set true in the deployed
  /// (Pi) environment.
  ENABLE_SCHEDULER: envBool('false'),
  /// Cron expression for the daily cycle. Default = 4:30pm, Mon–Fri (after the
  /// US market close), interpreted in SCHEDULE_TZ.
  SCHEDULE_CRON: z.string().default('30 16 * * 1-5'),
  /// Timezone for SCHEDULE_CRON — pinned to market time so the cycle fires
  /// correctly regardless of the host's locale (e.g. a Pi running UTC).
  SCHEDULE_TZ: z.string().default('America/New_York'),
  /// Safety gate for when order execution (Alpaca submitOrder / Phase B) lands.
  /// Default true = record what we WOULD do, never place an order. Cycles today
  /// are analysis-only, so this is forward-compat; flip to false only after
  /// backtests justify arming.
  RUNNER_DRY_RUN: envBool('true'),

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
  /// Default = head trader's model. The synthesis step gets the premium tier.
  LLM_MODEL: z.string().default('gpt-4o'),
  /// Cheaper model for specialists + audit agents + critic. Defaults to
  /// gpt-4o-mini for ~6× cost reduction on the pattern-recognition tier.
  /// Set both to the same value if you want everything on one model.
  LLM_MODEL_SPECIALIST: z.string().default('gpt-4o-mini'),
  LLM_TEMPERATURE: z.coerce.number().default(0.2),
  OPENAI_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  /// Soft cap for the in-process token bucket on the LLM adapter. OpenAI's
  /// default tier-1 rate limit is 500 requests/min; we leave headroom.
  LLM_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),

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
