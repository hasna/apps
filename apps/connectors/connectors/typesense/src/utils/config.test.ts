import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { clearConfig, getConfigDir, setApiKey, setCurrentProfile } from './config';

afterEach(() => {
  const configDir = getConfigDir();
  if (existsSync(configDir)) rmSync(configDir, { recursive: true, force: true });
});

describe('Typesense config storage', () => {
  test('stores API key profiles with owner-only permissions', () => {
    setApiKey('sensitive-key');

    const configDir = getConfigDir();
    const profilesDir = join(configDir, 'profiles');
    const profileFile = join(profilesDir, 'default.json');

    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(profilesDir).mode & 0o777).toBe(0o700);
    expect(statSync(profileFile).mode & 0o777).toBe(0o600);
  });

  test('stores the current profile marker with owner-only permissions', () => {
    clearConfig();
    setCurrentProfile('default');

    const currentProfileFile = join(getConfigDir(), 'current_profile');
    expect(statSync(currentProfileFile).mode & 0o777).toBe(0o600);
  });
});
