import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI_PATH = new URL('./index.ts', import.meta.url).pathname;
const homes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'connect-xray-cli-'));
  homes.push(home);
  return home;
}

async function run(args: string[], home: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], {
    env: {
      ...process.env,
      HOME: home,
      NO_COLOR: '1',
      XRAY_API_KEY: 'xray-test-key-12345',
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

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('connect-xray CLI profiles', () => {
  test('--profile default is accepted without a default profile file', async () => {
    const home = makeHome();
    const result = await run(['--profile', 'default', 'config', 'show'], home);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Active Profile: default');
  });

  test('profile use default is accepted without a default profile file', async () => {
    const home = makeHome();
    const result = await run(['profile', 'use', 'default'], home);
    const currentProfilePath = join(home, '.hasna', 'connectors', 'connect-xray', 'current_profile');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Switched to profile: default');
    expect(existsSync(currentProfilePath)).toBe(true);
    expect(readFileSync(currentProfilePath, 'utf-8')).toBe('default');
  });
});
