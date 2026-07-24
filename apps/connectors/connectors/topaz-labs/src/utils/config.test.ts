import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type ConfigModule = typeof import('./config');

const tempHomes: string[] = [];
const originalHome = process.env.HOME;

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

async function loadConfigForHome(home: string): Promise<ConfigModule> {
  process.env.HOME = home;
  return import(`./config.ts?home=${Date.now()}-${Math.random()}`) as Promise<ConfigModule>;
}

function makeHome(): string {
  const path = join(tmpdir(), `topaz-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  tempHomes.push(path);
  return path;
}

afterEach(() => {
  process.env.HOME = originalHome;
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('Topaz config permissions', () => {
  test('creates config/profile directories as 0700 and key-bearing files as 0600', async () => {
    const home = makeHome();
    const config = await loadConfigForHome(home);

    expect(config.createProfile('work', { apiKey: 'test-key' })).toBe(true);
    config.setCurrentProfile('work');

    const configDir = config.getConfigDir();
    const profilesDir = config.getProfilesDir();
    const profilePath = join(profilesDir, 'work.json');
    const currentProfilePath = config.getCurrentProfileFile();

    expect(mode(configDir)).toBe(0o700);
    expect(mode(profilesDir)).toBe(0o700);
    expect(mode(profilePath)).toBe(0o600);
    expect(mode(currentProfilePath)).toBe(0o600);
    expect(readFileSync(profilePath, 'utf-8')).toContain('test-key');
    expect(readFileSync(currentProfilePath, 'utf-8')).toBe('work');
  });

  test('tightens existing permissive config directories and profile files', async () => {
    const home = makeHome();
    const configDir = join(home, '.hasna', 'connectors', 'topaz-labs');
    const profilesDir = join(configDir, 'profiles');
    const profilePath = join(profilesDir, 'default.json');
    const currentProfilePath = join(configDir, 'current_profile');
    mkdirSync(profilesDir, { recursive: true, mode: 0o755 });
    chmodSync(configDir, 0o755);
    chmodSync(profilesDir, 0o755);
    writeFileSync(profilePath, JSON.stringify({ apiKey: 'test-key' }), { mode: 0o644 });
    writeFileSync(currentProfilePath, 'default', { mode: 0o644 });

    const config = await loadConfigForHome(home);
    config.ensureConfigDir();
    expect(config.loadProfile('default')).toEqual({ apiKey: 'test-key' });
    expect(config.getCurrentProfile()).toBe('default');

    expect(existsSync(configDir)).toBe(true);
    expect(mode(configDir)).toBe(0o700);
    expect(mode(profilesDir)).toBe(0o700);
    expect(mode(profilePath)).toBe(0o600);
    expect(mode(currentProfilePath)).toBe(0o600);
  });
});
