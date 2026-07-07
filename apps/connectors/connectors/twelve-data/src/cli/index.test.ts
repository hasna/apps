import { afterEach, describe, expect, test } from 'bun:test';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('connect-twelve-data CLI', () => {
  test('honors the root --format json option for API commands', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ price: '123.45', symbol: 'AAPL' });
        },
      }) as Response) as unknown as typeof fetch;

    process.env.TWELVE_DATA_API_KEY = 'test-key';
    process.env.TWELVE_DATA_BASE_URL = 'https://api.twelvedata.test';
    const originalArgv = process.argv;
    const originalExit = process.exit;
    const logs: string[] = [];
    const originalLog = console.log;

    process.argv = ['bun', 'connect-twelve-data', '--format', 'json', 'price', 'AAPL'];
    console.log = (message?: unknown) => {
      logs.push(String(message));
    };
    process.exit = ((code?: string | number | null) => {
      throw new Error(`unexpected exit ${code}`);
    }) as typeof process.exit;

    try {
      await import(`./index?format-json-test=${Date.now()}`);
      for (let attempt = 0; logs.length === 0 && attempt < 20; attempt += 1) {
        await Bun.sleep(5);
      }
    } finally {
      process.argv = originalArgv;
      process.exit = originalExit;
      console.log = originalLog;
      delete process.env.TWELVE_DATA_API_KEY;
      delete process.env.TWELVE_DATA_BASE_URL;
    }

    expect(JSON.parse(logs.join('\n'))).toEqual({ price: '123.45', symbol: 'AAPL' });
  });
});
