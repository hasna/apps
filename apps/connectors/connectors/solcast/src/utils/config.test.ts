import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearConfig, getApiKey, loadConfig, setApiKey } from './config';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const API_KEY_ENV_VAR = ['SOLCAST', 'API', 'KEY'].join('_');
const ORIGINAL_VALUE = process.env[API_KEY_ENV_VAR];

let testHome = '';

function restoreEnv(): void {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }
  if (ORIGINAL_USERPROFILE === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = ORIGINAL_USERPROFILE;
  }
  if (ORIGINAL_VALUE === undefined) {
    delete process.env[API_KEY_ENV_VAR];
  } else {
    process.env[API_KEY_ENV_VAR] = ORIGINAL_VALUE;
  }
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'connect-solcast-config-'));
  process.env.HOME = testHome;
  delete process.env.USERPROFILE;
  delete process.env[API_KEY_ENV_VAR];
});

afterEach(() => {
  if (testHome && existsSync(testHome)) {
    rmSync(testHome, { recursive: true, force: true });
  }
  restoreEnv();
});

describe('Solcast CLI config', () => {
  test('missing config reads are side-effect-free', () => {
    expect(loadConfig()).toEqual({});
    expect(getApiKey()).toBeUndefined();
    expect(existsSync(join(testHome, '.hasna'))).toBe(false);
  });

  test('reads dashboard-saved key from shared prefixless profile config', () => {
    const profileDir = join(testHome, '.hasna', 'connectors', 'solcast', 'profiles', 'default');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, 'config.json'),
      JSON.stringify({ apiKey: 'profile-solcast-key', baseUrl: 'https://profile.example.test' }),
    );

    expect(getApiKey()).toBe('profile-solcast-key');
    expect(loadConfig()).toEqual({
      apiKey: 'profile-solcast-key',
      baseUrl: 'https://profile.example.test',
    });
  });

  test('reads legacy flat profiles and lets prefixless profiles win', () => {
    const legacyConfigDir = join(testHome, '.hasna', 'connectors', 'connect-solcast');
    mkdirSync(join(legacyConfigDir, 'profiles'), { recursive: true });
    writeFileSync(join(legacyConfigDir, 'current_profile'), 'work');
    writeFileSync(
      join(legacyConfigDir, 'profiles', 'work.json'),
      JSON.stringify({ apiKey: 'legacy-profile-key', baseUrl: 'https://legacy.example.test' }),
    );

    const sharedProfileDir = join(testHome, '.hasna', 'connectors', 'solcast', 'profiles', 'work');
    mkdirSync(sharedProfileDir, { recursive: true });
    writeFileSync(
      join(sharedProfileDir, 'config.json'),
      JSON.stringify({ apiKey: 'shared-profile-key' }),
    );

    expect(loadConfig()).toEqual({
      apiKey: 'shared-profile-key',
      baseUrl: 'https://legacy.example.test',
    });
    expect(getApiKey()).toBe('shared-profile-key');
  });

  test('setApiKey writes shared profile config with owner-only permissions', () => {
    setApiKey('cli-solcast-key');

    const configDir = join(testHome, '.hasna', 'connectors', 'solcast');
    const profilesDir = join(configDir, 'profiles');
    const profileDir = join(profilesDir, 'default');
    const configFile = join(profileDir, 'config.json');

    expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toEqual({
      apiKey: 'cli-solcast-key',
    });
    expect(mode(configDir)).toBe(0o700);
    expect(mode(profilesDir)).toBe(0o700);
    expect(mode(profileDir)).toBe(0o700);
    expect(mode(configFile)).toBe(0o600);
    expect(existsSync(join(testHome, '.hasna', 'connectors', 'connect-solcast'))).toBe(false);
  });

  test('invalid current_profile falls back to default without path traversal', () => {
    const configDir = join(testHome, '.hasna', 'connectors', 'solcast');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'current_profile'), '../outside');

    setApiKey('safe-solcast-key');

    const configFile = join(configDir, 'profiles', 'default', 'config.json');
    expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toEqual({
      apiKey: 'safe-solcast-key',
    });
    expect(existsSync(join(testHome, '.hasna', 'connectors', 'outside'))).toBe(false);
  });

  test('clearConfig clears legacy fallback credentials', () => {
    const legacyConfigDir = join(testHome, '.hasna', 'connectors', 'connect-solcast');
    const legacyProfileDir = join(legacyConfigDir, 'profiles', 'default');
    mkdirSync(legacyProfileDir, { recursive: true });
    writeFileSync(
      join(legacyConfigDir, 'config.json'),
      JSON.stringify({ apiKey: 'legacy-root-key' }),
    );
    writeFileSync(
      join(legacyProfileDir, 'config.json'),
      JSON.stringify({ apiKey: 'legacy-profile-key' }),
    );

    expect(getApiKey()).toBe('legacy-profile-key');

    clearConfig();

    expect(getApiKey()).toBeUndefined();
    expect(loadConfig()).toEqual({});
    expect(JSON.parse(readFileSync(join(legacyConfigDir, 'config.json'), 'utf-8'))).toEqual({});
    expect(JSON.parse(readFileSync(join(legacyProfileDir, 'config.json'), 'utf-8'))).toEqual({});
  });
});
