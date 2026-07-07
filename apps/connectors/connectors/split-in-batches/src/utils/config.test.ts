import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createProfile,
  getConfigDir,
  setApiKey,
  setCurrentProfile,
} from './config';

const originalHome = process.env.HOME;

function useTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'split-in-batches-config-'));
  process.env.HOME = home;
  return home;
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

afterEach(() => {
  const currentHome = process.env.HOME;
  process.env.HOME = originalHome;

  if (currentHome && currentHome !== originalHome && existsSync(currentHome)) {
    rmSync(currentHome, { recursive: true, force: true });
  }
});

describe('config file permissions', () => {
  test('stores API key profiles in private files and directories', () => {
    useTempHome();

    setApiKey('test-key');

    const configDir = getConfigDir();
    expect(mode(configDir)).toBe(0o700);
    expect(mode(join(configDir, 'profiles'))).toBe(0o700);
    expect(mode(join(configDir, 'profiles', 'default.json'))).toBe(0o600);
  });

  test('stores current profile marker privately', () => {
    useTempHome();

    createProfile('work');
    setCurrentProfile('work');

    const configDir = getConfigDir();
    expect(mode(join(configDir, 'current_profile'))).toBe(0o600);
  });
});
