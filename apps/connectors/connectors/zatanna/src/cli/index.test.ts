import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let server: ReturnType<typeof Bun.serve> | undefined;
let homeDir: string | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
  if (homeDir) {
    rmSync(homeDir, { recursive: true, force: true });
    homeDir = undefined;
  }
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  homeDir = mkdtempSync(join(tmpdir(), 'connect-zatanna-home-'));
  const proc = Bun.spawn([process.execPath, 'run', './src/cli/index.ts', ...args], {
    cwd: import.meta.dir.replace(/\/src\/cli$/, ''),
    env: {
      ...process.env,
      HOME: homeDir,
      NO_COLOR: '1',
      ZATANNA_API_KEY: 'zat_test',
      ZATANNA_BASE_URL: `http://127.0.0.1:${server?.port}/v1`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe('Zatanna CLI', () => {
  test('honors root json output format for workflow commands', async () => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        expect(url.pathname).toBe('/v1/workflows');
        expect(url.searchParams.get('query')).toBe('claims portal');
        return Response.json([{ id: 'workflow_1', name: 'Claims portal' }]);
      },
    });

    const result = await runCli(['--format', 'json', 'workflows', 'search', '--query', 'claims portal']);

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ id: 'workflow_1', name: 'Claims portal' }]);
  });
});
