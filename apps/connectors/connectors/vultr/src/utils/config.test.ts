import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let configDir: string;
let config: typeof import('./config');

describe('Vultr config storage', () => {
  beforeAll(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'connect-vultr-config-'));
    process.env.VULTR_CONFIG_DIR = configDir;
    config = await import('./config');
  });

  afterAll(() => {
    delete process.env.VULTR_CONFIG_DIR;
    rmSync(configDir, { recursive: true, force: true });
  });

  test('stores API key profiles with owner-only permissions', () => {
    config.setApiKey('test-vultr-token');

    const profilePath = join(configDir, 'profiles', 'default.json');
    expect(config.getApiKey()).toBe('test-vultr-token');
    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(configDir, 'profiles')).mode & 0o777).toBe(0o700);
    expect(statSync(profilePath).mode & 0o777).toBe(0o600);
  });

  test('stores current profile marker with owner-only permissions', () => {
    config.createProfile('staging');
    config.setCurrentProfile('staging');

    const currentProfilePath = join(configDir, 'current_profile');
    expect(config.getCurrentProfile()).toBe('staging');
    expect(statSync(currentProfilePath).mode & 0o777).toBe(0o600);
  });
});
