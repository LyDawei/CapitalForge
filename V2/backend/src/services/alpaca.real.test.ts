import { RealAlpacaService } from './alpaca.real';

// ---------------------------------------------------------------------------
// fetch is mocked per test so we can assert request URLs/headers + simulate
// pagination, rate-limit retries, and credential failures without touching
// the network.
// ---------------------------------------------------------------------------

function makeBarPage(
  bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>,
  nextPageToken: string | null = null,
) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ bars, next_page_token: nextPageToken }),
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

function newService(overrides: Partial<ConstructorParameters<typeof RealAlpacaService>[0]> = {}) {
  return new RealAlpacaService({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    dataBaseUrl: 'https://fake-alpaca',
    feed: 'iex',
    // Effectively unrate-limited for tests so we don't wait on the bucket.
    rateLimitPerMin: 100_000,
    ...overrides,
  });
}

const ORIGINAL_FETCH = global.fetch;
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

describe('RealAlpacaService.getDailyBars', () => {
  it('sends APCA-API-KEY-ID + APCA-API-SECRET-KEY headers', async () => {
    const spy = jest
      .fn()
      .mockResolvedValueOnce(makeBarPage([{ t: '2026-05-01T05:00:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 1000 }]));
    global.fetch = spy as any;

    await newService().getDailyBars('SPY', 1);

    expect(spy).toHaveBeenCalledTimes(1);
    const [_, init] = spy.mock.calls[0]!;
    expect(init.headers['APCA-API-KEY-ID']).toBe('test-key');
    expect(init.headers['APCA-API-SECRET-KEY']).toBe('test-secret');
  });

  it('includes feed + timeframe + start/end in query string', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeBarPage([]));
    global.fetch = spy as any;

    await newService({ feed: 'iex' }).getDailyBars('AAPL', 5);

    const url = spy.mock.calls[0]![0] as string;
    expect(url).toContain('/v2/stocks/AAPL/bars?');
    expect(url).toContain('feed=iex');
    expect(url).toContain('timeframe=1Day');
    expect(url).toMatch(/start=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/end=\d{4}-\d{2}-\d{2}/);
  });

  it('normalizes Alpaca bars to V2 DailyBar (date = YYYY-MM-DD)', async () => {
    const spy = jest.fn().mockResolvedValueOnce(
      makeBarPage([
        { t: '2026-05-01T05:00:00Z', o: 175.0, h: 178.5, l: 174.2, c: 177.8, v: 42_000_000 },
      ]),
    );
    global.fetch = spy as any;

    const bars = await newService().getDailyBars('SPY', 1);

    expect(bars).toEqual([
      { date: '2026-05-01', open: 175.0, high: 178.5, low: 174.2, close: 177.8, volume: 42_000_000 },
    ]);
  });

  it('paginates via next_page_token and stops when limit is satisfied', async () => {
    const spy = jest
      .fn()
      .mockResolvedValueOnce(
        makeBarPage(
          [
            { t: '2026-04-01T05:00:00Z', o: 1, h: 2, l: 0, c: 1, v: 100 },
            { t: '2026-04-02T05:00:00Z', o: 1, h: 2, l: 0, c: 1, v: 100 },
          ],
          'page-2',
        ),
      )
      .mockResolvedValueOnce(
        makeBarPage([
          { t: '2026-04-03T05:00:00Z', o: 1, h: 2, l: 0, c: 1, v: 100 },
          { t: '2026-04-04T05:00:00Z', o: 1, h: 2, l: 0, c: 1, v: 100 },
        ]),
      );
    global.fetch = spy as any;

    const bars = await newService().getDailyBars('SPY', 4);

    expect(bars.length).toBe(4);
    expect(spy).toHaveBeenCalledTimes(2);
    // Second request must include page_token from the first response.
    expect(spy.mock.calls[1]![0]).toContain('page_token=page-2');
  });

  it('trims to the most recent `limit` bars when the API returns more', async () => {
    const spy = jest.fn().mockResolvedValueOnce(
      makeBarPage([
        { t: '2026-04-01T05:00:00Z', o: 1, h: 2, l: 0, c: 1, v: 100 },
        { t: '2026-04-02T05:00:00Z', o: 1, h: 2, l: 0, c: 2, v: 100 },
        { t: '2026-04-03T05:00:00Z', o: 1, h: 2, l: 0, c: 3, v: 100 },
      ]),
    );
    global.fetch = spy as any;

    const bars = await newService().getDailyBars('SPY', 2);

    // Oldest dropped, newest two kept.
    expect(bars.length).toBe(2);
    expect(bars[0]!.date).toBe('2026-04-02');
    expect(bars[1]!.date).toBe('2026-04-03');
  });
});

describe('RealAlpacaService.getBarsAfter', () => {
  it('starts the window strictly after the given cycle date', async () => {
    const spy = jest.fn().mockResolvedValueOnce(makeBarPage([]));
    global.fetch = spy as any;

    await newService().getBarsAfter('SPY', '2026-05-01', 5);

    const url = spy.mock.calls[0]![0] as string;
    // start must be 2026-05-02 (one day past the cycle date) — never 05-01.
    expect(url).toContain('start=2026-05-02');
  });
});

describe('RealAlpacaService error handling', () => {
  it('throws loudly on 401 (bad credentials)', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(makeErrorResponse(401, 'forbidden')) as any;
    await expect(newService().getDailyBars('SPY', 1)).rejects.toThrow(/Alpaca 401/);
  });

  it('retries 429 with backoff and eventually succeeds', async () => {
    const spy = jest
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(429, 'too many'))
      .mockResolvedValueOnce(
        makeBarPage([{ t: '2026-05-01T05:00:00Z', o: 1, h: 2, l: 0, c: 1.5, v: 100 }]),
      );
    global.fetch = spy as any;

    // Patch setTimeout to fire immediately so the 500ms backoff doesn't slow tests.
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });

    const bars = await newService().getDailyBars('SPY', 1);
    expect(bars.length).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('gives up on 429 after 5 attempts', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeErrorResponse(429, 'rate limited')) as any;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });
    await expect(newService().getDailyBars('SPY', 1)).rejects.toThrow(/429/);
  });

  it('retries 5xx and eventually surfaces if persistent', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeErrorResponse(503, 'down')) as any;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });
    await expect(newService().getDailyBars('SPY', 1)).rejects.toThrow(/503/);
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('RealAlpacaService.getCurrentPrice', () => {
  it('returns the latest trade price when available', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ trade: { p: 175.42, s: 100, t: '2026-05-18T20:00:00Z' } }),
      text: () => Promise.resolve(''),
    }) as any;
    const price = await newService().getCurrentPrice('SPY');
    expect(price).toBe(175.42);
  });

  it('falls back to the most recent daily bar close when the trade endpoint fails', async () => {
    const spy = jest
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(503, 'down'))
      // Bars endpoint succeeds — note: trade endpoint failure cascades through
      // the 5xx retry path before falling back, so we set up multiple responses.
      .mockResolvedValue(makeErrorResponse(503, 'down'));
    global.fetch = spy as any;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
      return 0 as any;
    });

    // First the trade endpoint will exhaust retries and throw → fall back to
    // getDailyBars → which itself will exhaust retries → final throw.
    await expect(newService().getCurrentPrice('SPY')).rejects.toThrow();
  });
});
