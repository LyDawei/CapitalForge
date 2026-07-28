import { RealOpenAILlmService } from './llm.openai';

// ---------------------------------------------------------------------------
// fetch mocked. We assert request shape (headers, JSON mode, model selection,
// system/user split) and response handling (token + cost math, retry paths,
// fail-loud on 401).
// ---------------------------------------------------------------------------

function newService(overrides: Partial<ConstructorParameters<typeof RealOpenAILlmService>[0]> = {}) {
  return new RealOpenAILlmService({
    apiKey: 'sk-test-key',
    defaultModel: 'gpt-4o',
    rateLimitPerMin: 100_000,
    temperature: 0.2,
    ...overrides,
  });
}

function makeChatResponse(model: string, content: string, promptTokens = 500, completionTokens = 100) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        model,
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      }),
    text: () => Promise.resolve(''),
  };
}

function makeErrorResponse(status: number, body = '') {
  return {
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  };
}

const ORIGINAL_FETCH = global.fetch;
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

describe('RealOpenAILlmService.complete', () => {
  it('sends bearer auth + JSON content-type', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeChatResponse('gpt-4o', '{"ok":true}'));
    global.fetch = spy as any;

    await newService().complete({ prompt: 'Respond JSON only: {}' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('enables JSON mode in request body', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeChatResponse('gpt-4o', '{}'));
    global.fetch = spy as any;

    await newService().complete({ prompt: 'Respond JSON only: {}' });

    const body = JSON.parse(spy.mock.calls[0]![1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('splits systemPrompt + prompt into system + user messages', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeChatResponse('gpt-4o', '{}'));
    global.fetch = spy as any;

    await newService().complete({
      prompt: 'role-specific instructions',
      systemPrompt: 'discipline framework',
    });

    const body = JSON.parse(spy.mock.calls[0]![1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: 'discipline framework' },
      { role: 'user', content: 'role-specific instructions' },
    ]);
  });

  it('uses the provided model param, not the default', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeChatResponse('gpt-4o-mini', '{}'));
    global.fetch = spy as any;

    await newService({ defaultModel: 'gpt-4o' }).complete({
      prompt: '{}',
      model: 'gpt-4o-mini',
    });

    const body = JSON.parse(spy.mock.calls[0]![1].body);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('computes cost from usage with gpt-4o pricing', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeChatResponse('gpt-4o', '{}', 1_000_000, 100_000));
    global.fetch = spy as any;

    const completion = await newService().complete({ prompt: '{}', model: 'gpt-4o' });

    // gpt-4o: $2.50/M in + $10/M out → 1.0M in + 0.1M out = $2.50 + $1.00 = $3.50
    expect(completion.costUsd).toBeCloseTo(3.5, 5);
    expect(completion.tokensIn).toBe(1_000_000);
    expect(completion.tokensOut).toBe(100_000);
    expect(completion.provider).toBe('openai');
    expect(completion.modelName).toBe('gpt-4o');
  });

  it('computes cost from usage with gpt-4o-mini pricing', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeChatResponse('gpt-4o-mini', '{}', 1_000_000, 100_000));
    global.fetch = spy as any;

    const completion = await newService().complete({ prompt: '{}', model: 'gpt-4o-mini' });

    // gpt-4o-mini: $0.15/M in + $0.60/M out → 1.0M in + 0.1M out = $0.15 + $0.06 = $0.21
    expect(completion.costUsd).toBeCloseTo(0.21, 5);
  });

  it('returns the assistant message text verbatim', async () => {
    const out = '{"bullishScore": 0.42, "confidence": 0.7, "rationale": ["a", "b"]}';
    global.fetch = jest.fn().mockResolvedValueOnce(makeChatResponse('gpt-4o', out)) as any;
    const completion = await newService().complete({ prompt: '{}' });
    expect(completion.text).toBe(out);
  });
});

describe('RealOpenAILlmService error handling', () => {
  it('throws loudly on 401 (bad credentials) without retry', async () => {
    const spy = jest.fn().mockResolvedValue(makeErrorResponse(401, 'invalid_api_key'));
    global.fetch = spy as any;
    await expect(newService().complete({ prompt: '{}' })).rejects.toThrow(/OpenAI 401/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throws loudly on 400 (bad request) without retry', async () => {
    const spy = jest.fn().mockResolvedValue(makeErrorResponse(400, 'invalid_messages'));
    global.fetch = spy as any;
    await expect(newService().complete({ prompt: '{}' })).rejects.toThrow(/OpenAI 400/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries 429 with backoff and eventually succeeds', async () => {
    const spy = jest
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(429, 'rate_limit'))
      .mockResolvedValueOnce(makeChatResponse('gpt-4o', '{}'));
    global.fetch = spy as any;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });

    const completion = await newService().complete({ prompt: '{}' });
    expect(completion.text).toBe('{}');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('gives up on 429 after 5 attempts', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeErrorResponse(429, 'rate_limit')) as any;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });
    await expect(newService().complete({ prompt: '{}' })).rejects.toThrow(/429/);
  });

  it('retries 5xx and surfaces if persistent', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeErrorResponse(503, 'overloaded')) as any;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });
    await expect(newService().complete({ prompt: '{}' })).rejects.toThrow(/503/);
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
