import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const testConfigDir = join(tmpdir(), `tinybird-config-test-${process.pid}`);
process.env.TINYBIRD_CONFIG_DIR = testConfigDir;

const {
  createProfile,
  getConfigDir,
  saveProfile,
  setCurrentProfile,
  setApiKey,
} = await import('./config');

const configDir = getConfigDir();

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

afterEach(() => {
  if (existsSync(configDir)) {
    rmSync(configDir, { recursive: true, force: true });
  }
});

describe('Tinybird config storage', () => {
  test('stores profile credentials with owner-only permissions', () => {
    setApiKey('p.test-token');
    const profilePath = join(configDir, 'profiles', 'default.json');

    expect(mode(configDir)).toBe(0o700);
    expect(mode(join(configDir, 'profiles'))).toBe(0o700);
    expect(mode(profilePath)).toBe(0o600);
  });

  test('stores created profiles and current marker with owner-only permissions', () => {
    expect(createProfile('work', { api_token: 'p.work-token' })).toBe(true);
    setCurrentProfile('work');
    saveProfile({ api_token: 'p.updated' }, 'work');

    expect(mode(join(configDir, 'profiles', 'work.json'))).toBe(0o600);
    expect(mode(join(configDir, 'current_profile'))).toBe(0o600);
  });
});
