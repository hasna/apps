import { describe, expect, test } from 'bun:test';

describe('config env overrides', () => {
  test('does not touch profile storage for pure environment-token usage', async () => {
    const configUrl = new URL('./config.ts', import.meta.url).href;
    const accessTokenEnvName = ['SUPABASE_API_PLATFORM', 'ACCESS', 'TOKEN'].join('_');
    const script = `
      const { getAccessToken, getBaseUrl } = await import(${JSON.stringify(configUrl)});
      if (getAccessToken() !== 'test-env-token') {
        throw new Error('env token was not used');
      }
      if (getBaseUrl() !== undefined) {
        throw new Error('base URL should not be loaded from profile storage');
      }
    `;
    const proc = Bun.spawn([process.execPath, '-e', script], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: '/proc',
        USERPROFILE: '/proc',
        [accessTokenEnvName]: 'test-env-token',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
  });
});
