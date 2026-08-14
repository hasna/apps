import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const originalConfigDir = process.env.SPROUTSOCIAL_CONFIG_DIR;
const tempConfigDirs: string[] = [];

async function loadIsolatedConfig() {
  const tempRoot = tmpdir();
  mkdirSync(tempRoot, { recursive: true });
  const configDir = mkdtempSync(join(tempRoot, 'sprout-social-config-'));
  tempConfigDirs.push(configDir);
  process.env.SPROUTSOCIAL_CONFIG_DIR = configDir;

  const config = await import(`./config.ts?dir=${encodeURIComponent(configDir)}&t=${Date.now()}`);
  return { config, configDir };
}

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.SPROUTSOCIAL_CONFIG_DIR;
  } else {
    process.env.SPROUTSOCIAL_CONFIG_DIR = originalConfigDir;
  }

  while (tempConfigDirs.length > 0) {
    const configDir = tempConfigDirs.pop();
    if (configDir) {
      rmSync(configDir, { recursive: true, force: true });
    }
  }
});

describe('SproutSocial profile config', () => {
  test('writes token-bearing profile files with owner-only permissions', async () => {
    const { config, configDir } = await loadIsolatedConfig();

    config.setAccessToken('test-token');

    const profilePath = join(configDir, 'profiles', 'default.json');
    expect(statSync(profilePath).mode & 0o777).toBe(0o600);
    expect(config.loadProfile().accessToken).toBe('test-token');
  });

  test('rejects invalid profile names before path construction', async () => {
    const { config } = await loadIsolatedConfig();

    expect(config.profileExists('../outside')).toBe(false);
    expect(() => config.loadProfile('../outside')).toThrow(/profile name/i);
    expect(() => config.saveProfile({}, '../outside')).toThrow(/profile name/i);
  });
});
