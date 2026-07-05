import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const originalConfigDir = process.env.UPSTASH_API_PLATFORM_CONFIG_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  process.env.UPSTASH_API_PLATFORM_CONFIG_DIR = originalConfigDir;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('Upstash API Platform config storage', () => {
  test('stores profiles privately and rejects unsafe profile paths', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'upstash-api-platform-config-'));
    tempDirs.push(configDir);
    process.env.UPSTASH_API_PLATFORM_CONFIG_DIR = configDir;

    const config = await import(`./config?configDir=${encodeURIComponent(configDir)}`);
    config.setApiKey('management-key');
    config.setCurrentProfile('default');

    const profilesDir = join(configDir, 'profiles');

    expect(mode(configDir)).toBe(0o700);
    expect(mode(profilesDir)).toBe(0o700);
    expect(mode(join(profilesDir, 'default.json'))).toBe(0o600);
    expect(mode(join(configDir, 'current_profile'))).toBe(0o600);

    expect(() => config.createProfile('../outside')).toThrow('Profile name can only contain');
    expect(() => config.loadProfile('../outside')).toThrow('Profile name can only contain');
    expect(() => config.saveProfile({ apiKey: 'test-key' }, '../outside')).toThrow('Profile name can only contain');
    expect(() => config.profileExists('../outside')).toThrow('Profile name can only contain');
    expect(existsSync(join(configDir, 'outside.json'))).toBe(false);
    expect(existsSync(join(configDir, '..', 'outside.json'))).toBe(false);
  });
});
