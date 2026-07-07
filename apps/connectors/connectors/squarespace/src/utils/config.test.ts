import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const home = mkdtempSync(join(tmpdir(), 'connect-squarespace-home-'));
process.env.HOME = home;

const config = await import('./config');

describe('profile config storage', () => {
  test('rejects path traversal profile names on every profile path lookup', () => {
    expect(() => config.profileExists('../outside')).toThrow('Profile name can only contain');
    expect(() => config.loadProfile('../outside')).toThrow('Profile name can only contain');
  });

  test('stores config directories and files with private modes', () => {
    config.createProfile('private_mode', { apiKey: 'test-key' });
    config.setCurrentProfile('private_mode');

    const configDir = config.getConfigDir();
    const profilesDir = join(configDir, 'profiles');
    const profilePath = join(profilesDir, 'private_mode.json');
    const currentPath = join(configDir, 'current_profile');

    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(profilesDir).mode & 0o777).toBe(0o700);
    expect(statSync(profilePath).mode & 0o777).toBe(0o600);
    expect(statSync(currentPath).mode & 0o777).toBe(0o600);
  });
});

process.on('exit', () => {
  rmSync(home, { recursive: true, force: true });
});
