import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return '';
  }
  return await new Response(stream).text();
}

describe('ZeroSettle CLI', () => {
  test('raw-request honors root json format flag', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ok: true });
      },
    });
    const home = mkdtempSync(join(tmpdir(), 'zerosettle-cli-'));

    try {
      const proc = Bun.spawn(
        [
          process.execPath,
          new URL('./index.ts', import.meta.url).pathname,
          '-f',
          'json',
          '--publishable-key',
          'zs_pk_test_cli',
          'raw-request',
          '--path',
          '/ok',
        ],
        {
          env: {
            ...process.env,
            HOME: home,
            HASNA_CONNECTORS_DIR: join(home, '.hasna', 'connectors'),
            ZEROSETTLE_BASE_URL: server.url.toString().replace(/\/$/, ''),
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );

      const [stdout, stderr, exitCode] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr), proc.exited]);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ ok: true });
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('profile show displays shared auth apiKey profiles', async () => {
    const home = mkdtempSync(join(tmpdir(), 'zerosettle-cli-'));
    const profileDir = join(home, '.hasna', 'connectors', 'zerosettle', 'profiles', 'default');
    await Bun.write(join(profileDir, 'config.json'), JSON.stringify({ apiKey: 'zs_pk_shared_profile' }));

    try {
      const proc = Bun.spawn(
        [
          process.execPath,
          new URL('./index.ts', import.meta.url).pathname,
          'profile',
          'show',
        ],
        {
          env: {
            ...process.env,
            HOME: home,
            HASNA_CONNECTORS_DIR: join(home, '.hasna', 'connectors'),
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );

      const [stdout, stderr, exitCode] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr), proc.exited]);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('zs_pk_sh...');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
