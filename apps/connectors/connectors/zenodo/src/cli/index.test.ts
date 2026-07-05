import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const cliPath = new URL('./index.ts', import.meta.url).pathname;
const tempHomes: string[] = [];

function runCli(args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'connect-zenodo-home-'));
  tempHomes.push(home);

  return Bun.spawnSync({
    cmd: ['bun', 'run', cliPath, ...args],
    env: {
      ...process.env,
      HOME: home,
      ZENODO_ACCESS_TOKEN: 'test-token',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('Zenodo CLI profile selection', () => {
  test('allows selecting the implicit default profile with --profile', () => {
    const result = runCli(['--profile', 'default', 'config', 'show']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Active profile: default');
    expect(result.stderr.toString()).not.toContain('does not exist');
  });

  test('allows switching back to the implicit default profile', () => {
    const result = runCli(['profile', 'use', 'default']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Switched to profile: default');
    expect(result.stderr.toString()).not.toContain('does not exist');
  });
});
