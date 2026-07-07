import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const cliPath = new URL('./index.ts', import.meta.url).pathname;
const tempHomes: string[] = [];

function runCli(args: string[], env: Record<string, string> = {}) {
  return runCliWithHome(args, env).result;
}

function runCliWithHome(args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'connect-zenodo-home-'));
  tempHomes.push(home);

  const result = runCliInHome(home, args, env);
  return { home, result };
}

function runCliInHome(home: string, args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync({
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

  return result;
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

  test('stores token profiles with restrictive file permissions', () => {
    const { home, result } = runCliWithHome(['config', 'set-token', 'sensitive-token']);

    expect(result.exitCode).toBe(0);
    const configDir = join(home, '.hasna', 'connectors', 'connect-zenodo');
    const profilesDir = join(configDir, 'profiles');
    const profileFile = join(profilesDir, 'default.json');

    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(profilesDir).mode & 0o777).toBe(0o700);
    expect(statSync(profileFile).mode & 0o777).toBe(0o600);
  });

  test('stores the current profile marker with restrictive file permissions', () => {
    const { home, result } = runCliWithHome(['profile', 'use', 'default']);

    expect(result.exitCode).toBe(0);
    const currentProfileFile = join(home, '.hasna', 'connectors', 'connect-zenodo', 'current_profile');

    expect(statSync(currentProfileFile).mode & 0o777).toBe(0o600);
  });

  test('profile show does not leak env base URL into a named profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'connect-zenodo-home-'));
    tempHomes.push(home);

    const create = runCliInHome(home, ['profile', 'create', 'empty']);
    expect(create.exitCode).toBe(0);

    const show = runCliInHome(home, ['profile', 'show', 'empty'], {
      ZENODO_BASE_URL: 'https://sandbox.zenodo.org/api',
    });

    expect(show.exitCode).toBe(0);
    expect(show.stdout.toString()).toContain('Base URL: https://zenodo.org/api');
    expect(show.stdout.toString()).not.toContain('https://sandbox.zenodo.org/api');
  });
});
