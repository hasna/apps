import { afterEach, describe, expect, test } from 'bun:test';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('connect-wayco CLI', () => {
  test('honors the root --format json option for API commands', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify([{ id: 'case-1' }]);
        },
      }) as Response) as unknown as typeof fetch;

    process.env.WAYCO_API_KEY = 'test-key';
    process.env.WAYCO_BASE_URL = 'https://api.wayco.test/v1';
    const originalArgv = process.argv;
    const originalExit = process.exit;
    const logs: string[] = [];
    const originalLog = console.log;

    process.argv = ['bun', 'connect-wayco', '--format', 'json', 'list-cases'];
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
      delete process.env.WAYCO_API_KEY;
      delete process.env.WAYCO_BASE_URL;
    }

    expect(JSON.parse(logs.join('\n'))).toEqual([{ id: 'case-1' }]);
  });
});
