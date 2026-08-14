import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI_PATH = new URL('./index.ts', import.meta.url).pathname;
const homes: string[] = [];

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return '';
  }
  return await new Response(stream).text();
}

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'connect-zibra-labs-cli-'));
  homes.push(home);
  return home;
}

async function run(
  args: string[],
  home: string,
  baseUrl: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    env: {
      ...process.env,
      HOME: home,
      NO_COLOR: '1',
      ZIBRA_LABS_API_KEY: 'zibra-test-key',
      ZIBRA_LABS_BASE_URL: baseUrl,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('connect-zibra-labs CLI', () => {
  test('raw command honors root json format flag', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ok: true });
      },
    });

    try {
      const result = await run(['-f', 'json', 'raw', '-m', 'GET', '-p', '/health'], makeHome(), server.url.toString());

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true });
    } finally {
      server.stop(true);
    }
  });

  test('datasets list sends asset_class without duplicate camelCase query', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        return Response.json({ query: Array.from(url.searchParams.entries()) });
      },
    });

    try {
      const result = await run(
        ['-f', 'json', 'datasets', 'list', '--asset-class', 'equities'],
        makeHome(),
        server.url.toString(),
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ query: [['asset_class', 'equities']] });
    } finally {
      server.stop(true);
    }
  });
});
