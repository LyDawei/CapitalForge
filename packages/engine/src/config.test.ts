import { resetConfig, loadConfig } from './config';

describe('Config - Multi-symbol support', () => {
  beforeEach(() => {
    // Reset config singleton and clear env vars
    resetConfig();
    delete process.env.TRADING_SYMBOLS;
    delete process.env.TRADING_SYMBOL;
  });

  afterEach(() => {
    resetConfig();
  });

  test('should parse TRADING_SYMBOLS comma-separated list', () => {
    process.env.TRADING_SYMBOLS = 'SPY,QQQ,TSLA';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = loadConfig();
    expect(config.tradingSymbols).toEqual(['SPY', 'QQQ', 'TSLA']);
    expect(config.tradingSymbol).toBe('SPY'); // First symbol for backward compatibility
  });

  test('should trim whitespace from symbols', () => {
    process.env.TRADING_SYMBOLS = 'SPY , QQQ , TSLA ';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = loadConfig();
    expect(config.tradingSymbols).toEqual(['SPY', 'QQQ', 'TSLA']);
  });

  test('should filter empty symbols', () => {
    process.env.TRADING_SYMBOLS = 'SPY,,QQQ, ,TSLA';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = loadConfig();
    expect(config.tradingSymbols).toEqual(['SPY', 'QQQ', 'TSLA']);
  });

  test('should fall back to TRADING_SYMBOL for backward compatibility', () => {
    process.env.TRADING_SYMBOL = 'AAPL';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = loadConfig();
    expect(config.tradingSymbols).toEqual(['AAPL']);
    expect(config.tradingSymbol).toBe('AAPL');
  });

  test('should default to SPY if neither env var is set', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = loadConfig();
    expect(config.tradingSymbols).toEqual(['SPY']);
    expect(config.tradingSymbol).toBe('SPY');
  });

  test('should prioritize TRADING_SYMBOLS over TRADING_SYMBOL', () => {
    process.env.TRADING_SYMBOLS = 'QQQ,TSLA';
    process.env.TRADING_SYMBOL = 'AAPL';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = loadConfig();
    expect(config.tradingSymbols).toEqual(['QQQ', 'TSLA']);
    expect(config.tradingSymbol).toBe('QQQ');
  });
});
