import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const originalConfigDir = process.env.STRAND_CONFIG_DIR;
const tempHome = mkdtempSync(join(tmpdir(), 'strand-config-'));
process.env.STRAND_CONFIG_DIR = join(tempHome, 'connect-strand-ai');

afterAll(() => {
  if (originalConfigDir === undefined) {
    delete process.env.STRAND_CONFIG_DIR;
  } else {
    process.env.STRAND_CONFIG_DIR = originalConfigDir;
  }
  rmSync(tempHome, { recursive: true, force: true });
});

describe('config storage', () => {
  test('stores API-key profiles in private files', async () => {
    const config = await import('./config');

    expect(config.createProfile('secure', { apiKey: 'sk-strand-test-key' })).toBe(true);
    config.setCurrentProfile('secure');

    const configDir = join(tempHome, 'connect-strand-ai');
    const profilesDir = join(configDir, 'profiles');
    const profileFile = join(profilesDir, 'secure.json');
    const currentProfileFile = join(configDir, 'current_profile');

    expect(existsSync(profileFile)).toBe(true);
    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(profilesDir).mode & 0o777).toBe(0o700);
    expect(statSync(profileFile).mode & 0o777).toBe(0o600);
    expect(statSync(currentProfileFile).mode & 0o777).toBe(0o600);
  });
});
