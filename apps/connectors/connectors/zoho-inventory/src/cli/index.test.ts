import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

describe('Zoho Inventory CLI', () => {
  test('raw command honors global json format', async () => {
    const connectorDir = fileURLToPath(new URL('../..', import.meta.url));
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return Response.json({
          code: 0,
          ok: true,
          path: `${url.pathname}${url.search}`,
        });
      },
    });

    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, 'run', './src/cli/index.ts', '--format', 'json', 'raw', '/items'],
        cwd: connectorDir,
        env: {
          ...process.env,
          ZOHOINVENTORY_TOKEN: 'test-token',
          ZOHOINVENTORY_ORG_ID: 'org-123',
          ZOHOINVENTORY_BASE_URL: `http://127.0.0.1:${server.port}`,
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

      const result = JSON.parse(stdout) as { code: number; ok: boolean; path: string };
      expect(result).toEqual({
        code: 0,
        ok: true,
        path: '/items?organization_id=org-123',
      });
    } finally {
      server.stop(true);
    }
  });
});
