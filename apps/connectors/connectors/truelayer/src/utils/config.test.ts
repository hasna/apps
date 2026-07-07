import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const originalHome = process.env.HOME;
const testHome = mkdtempSync(join(tmpdir(), 'connect-truelayer-config-'));
process.env.HOME = testHome;

const config = await import('./config');

const configDir = join(testHome, '.hasna', 'connectors', 'connect-truelayer');
const profilesDir = join(configDir, 'profiles');
const profilePath = join(profilesDir, 'secure.json');
const currentProfilePath = join(configDir, 'current_profile');

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(testHome, { recursive: true, force: true });
});

describe('config file permissions', () => {
  test('creates config directories with user-only permissions', () => {
    config.ensureConfigDir();

    expect(mode(configDir)).toBe(0o700);
    expect(mode(profilesDir)).toBe(0o700);
  });

  test('stores profile tokens in user-only files', () => {
    config.createProfile('secure', { accessToken: 'test-token' });

    expect(mode(profilePath)).toBe(0o600);
    expect(JSON.parse(readFileSync(profilePath, 'utf-8')).accessToken).toBe('test-token');
  });

  test('tightens permissions when updating existing files', () => {
    chmodSync(profilePath, 0o644);
    config.saveProfile({ accessToken: 'updated-token' }, 'secure');

    expect(mode(profilePath)).toBe(0o600);
    expect(JSON.parse(readFileSync(profilePath, 'utf-8')).accessToken).toBe('updated-token');
  });

  test('stores current profile with user-only permissions', () => {
    config.setCurrentProfile('secure');

    expect(mode(currentProfilePath)).toBe(0o600);
    expect(readFileSync(currentProfilePath, 'utf-8')).toBe('secure');
  });
});
