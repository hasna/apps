import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Zoho Sign CLI', () => {
  test('account command honors global json format', async () => {
    const connectorDir = fileURLToPath(new URL('../..', import.meta.url));
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        expect(url.pathname).toBe('/account');
        return Response.json({
          status: 'success',
          account: {
            id: 'acct_123',
            name: 'Example Account',
          },
        });
      },
    });
    const home = mkdtempSync(join(tmpdir(), 'connect-zoho-sign-cli-'));

    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, 'run', './src/cli/index.ts', '--format', 'json', 'account'],
        cwd: connectorDir,
        env: {
          ...process.env,
          HOME: home,
          NO_COLOR: '1',
          ZOHO_SIGN_TOKEN: 'test-token',
          ZOHO_SIGN_BASE_URL: `http://127.0.0.1:${server.port}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);

      expect(JSON.parse(stdout)).toEqual({
        id: 'acct_123',
        name: 'Example Account',
      });
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
