import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProfile, saveProfile, setCurrentProfile } from './config';

let tempConfigDir: string | undefined;

function useTempConfigDir(): string {
  tempConfigDir = mkdtempSync(join(tmpdir(), 'textrazor-config-'));
  process.env.TEXTRAZOR_CONFIG_DIR = tempConfigDir;
  return tempConfigDir;
}

afterEach(() => {
  delete process.env.TEXTRAZOR_CONFIG_DIR;
  if (tempConfigDir) {
    rmSync(tempConfigDir, { recursive: true, force: true });
    tempConfigDir = undefined;
  }
});

describe('TextRazor config permissions', () => {
  test('writes profile and current-profile files with owner-only permissions', () => {
    const configDir = useTempConfigDir();

    expect(createProfile('secure', { apiKey: 'test-key' })).toBe(true);
    saveProfile({ apiKey: 'updated-key' }, 'secure');
    setCurrentProfile('secure');

    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(configDir, 'profiles')).mode & 0o777).toBe(0o700);
    expect(statSync(join(configDir, 'profiles', 'secure.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(configDir, 'current_profile')).mode & 0o777).toBe(0o600);
  });
});
