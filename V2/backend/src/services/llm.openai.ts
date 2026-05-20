/**
 * OpenAI Chat Completions adapter — the first real LLM provider for V2.
 *
 * Two model tiers in use:
 *   - Head trader        → env.LLM_MODEL (default 'gpt-4o')
 *   - Specialists/audit/critic → env.LLM_MODEL_SPECIALIST (default 'gpt-4o-mini')
 *
 * The model is selected at call time by the runner via the `model` param
 * on LlmService.complete — the adapter respects whatever it's handed.
 *
 * JSON mode is enabled unconditionally. The v0.3.0 prompts all contain a
 * `Respond JSON only` instruction so the JSON-mode requirement (prompt must
 * mention the word "json") is satisfied.
 *
 * Token accounting + cost math comes from response.usage. Per-model pricing
 * is hard-coded here; update when OpenAI changes their card.
 */
import type { LlmCompletion, LlmService } from './llm';

// USD per 1M tokens. Update with OpenAI's pricing page when it changes.
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
};

function costFor(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? PRICING['gpt-4o']!;
  return +((promptTokens * p.input + completionTokens * p.output) / 1_000_000).toFixed(6);
}

// ---------------------------------------------------------------------------
// Token bucket — same pattern used everywhere else in V2 (Alpaca, Finnhub).
// ---------------------------------------------------------------------------
class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private last: number;

  constructor(perMinute: number) {
    this.capacity = perMinute;
    this.tokens = perMinute;
    this.refillPerMs = perMinute / 60_000;
    this.last = Date.now();
  }

  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const wait = Math.ceil((1 - this.tokens) / this.refillPerMs);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs);
    this.last = now;
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export interface OpenAiLlmOptions {
  apiKey: string;
  /// Default model when caller doesn't specify. Used as the head-trader tier.
  defaultModel: string;
  /// Defaults to OpenAI public endpoint. Override for Azure / proxies.
  baseUrl?: string;
  rateLimitPerMin: number;
  temperature: number;
}

interface OpenAiChatResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

export class RealOpenAILlmService implements LlmService {
  private readonly headers: Record<string, string>;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly temperature: number;
  private readonly bucket: TokenBucket;

  constructor(opts: OpenAiLlmOptions) {
    this.headers = {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    };
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com';
    this.defaultModel = opts.defaultModel;
    this.temperature = opts.temperature;
    this.bucket = new TokenBucket(opts.rateLimitPerMin);
  }

  async complete(args: {
    prompt: string;
    model?: string;
    temperature?: number;
    systemPrompt?: string;
  }): Promise<LlmCompletion> {
    const model = args.model ?? this.defaultModel;
    const temperature = args.temperature ?? this.temperature;
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (args.systemPrompt) messages.push({ role: 'system', content: args.systemPrompt });
    messages.push({ role: 'user', content: args.prompt });

    const body = JSON.stringify({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    });

    const start = Date.now();
    const data = await this.request<OpenAiChatResponse>(`${this.baseUrl}/v1/chat/completions`, body);
    const latencyMs = Date.now() - start;

    const text = data.choices?.[0]?.message?.content ?? '';
    const tokensIn = data.usage?.prompt_tokens;
    const tokensOut = data.usage?.completion_tokens;
    const costUsd =
      tokensIn != null && tokensOut != null ? costFor(data.model ?? model, tokensIn, tokensOut) : undefined;

    return {
      text,
      latencyMs,
      tokensIn,
      tokensOut,
      costUsd,
      provider: 'openai',
      modelName: data.model ?? model,
    };
  }

  private async request<T>(url: string, body: string, attempt = 0): Promise<T> {
    await this.bucket.take();
    const res = await fetch(url, { method: 'POST', headers: this.headers, body });
    if (res.ok) return (await res.json()) as T;

    const responseBody = await res.text().catch(() => '');

    if (res.status === 401) {
      // Bad credentials never silently retry — fail loud immediately.
      throw new Error(`OpenAI 401: bad credentials. ${responseBody}`);
    }
    if (res.status === 400) {
      // Schema / prompt errors — won't help to retry. Surface immediately so
      // the runner records a parse error rather than burning more retries.
      throw new Error(`OpenAI 400: ${responseBody}`);
    }
    if (res.status === 429 && attempt < 4) {
      // Exponential backoff: 1s, 2s, 4s, 8s. OpenAI usually recovers fast.
      const wait = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
      return this.request<T>(url, body, attempt + 1);
    }
    if (res.status >= 500 && attempt < 3) {
      const wait = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
      return this.request<T>(url, body, attempt + 1);
    }
    throw new Error(`OpenAI ${res.status}: ${responseBody || res.statusText}`);
  }
}
