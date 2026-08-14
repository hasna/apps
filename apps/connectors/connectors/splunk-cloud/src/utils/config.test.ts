import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createProfile,
  ensureConfigDir,
  getConfigDir,
  setCurrentProfile,
  setProfileOverride,
  setToken,
} from './config';

let configDir: string;

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'splunk-cloud-config-'));
  process.env.SPLUNK_CLOUD_CONFIG_DIR = configDir;
  setProfileOverride(undefined);
});

afterEach(() => {
  delete process.env.SPLUNK_CLOUD_CONFIG_DIR;
  setProfileOverride(undefined);
  rmSync(configDir, { recursive: true, force: true });
});

describe('config storage permissions', () => {
  test('creates private config and profiles directories', () => {
    ensureConfigDir();

    expect(mode(getConfigDir())).toBe(0o700);
    expect(mode(join(getConfigDir(), 'profiles'))).toBe(0o700);
  });

  test('writes profile and current-profile files with owner-only permissions', () => {
    createProfile('prod', { baseUrl: 'https://stack.example.splunkcloud.com:8089' });
    setCurrentProfile('prod');
    setToken('test-token');

    expect(mode(join(getConfigDir(), 'profiles', 'prod.json'))).toBe(0o600);
    expect(mode(join(getConfigDir(), 'current_profile'))).toBe(0o600);
  });
});
