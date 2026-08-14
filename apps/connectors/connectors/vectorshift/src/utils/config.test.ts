import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createProfile,
  deleteProfile,
  ensureConfigDir,
  getConfigDir,
  getCurrentProfile,
  listProfiles,
  loadProfile,
  profileExists,
  saveProfile,
  setConfigHomeForTests,
  setCurrentProfile,
  setProfileOverride,
} from './config';

describe('VectorShift config utilities', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'connect-vectorshift-config-'));
    setConfigHomeForTests(testHome);
  });

  afterEach(() => {
    setConfigHomeForTests(undefined);
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  test('creates credential directories and files with owner-only modes', () => {
    expect(createProfile('safe_profile-1', { apiKey: 'secret' })).toBe(true);
    setCurrentProfile('safe_profile-1');

    const configDir = getConfigDir();
    const profilesDir = join(configDir, 'profiles');
    const profileFile = join(profilesDir, 'safe_profile-1.json');
    const currentProfileFile = join(configDir, 'current_profile');

    expect(fileMode(configDir)).toBe(0o700);
    expect(fileMode(profilesDir)).toBe(0o700);
    expect(fileMode(profileFile)).toBe(0o600);
    expect(fileMode(currentProfileFile)).toBe(0o600);
    expect(listProfiles()).toEqual(['safe_profile-1']);
  });

  test('validates profile names before constructing profile paths', () => {
    const invalidNames = ['../escape', 'bad/name', 'bad name', '.', ''];

    for (const name of invalidNames) {
      expect(() => profileExists(name)).toThrow('Profile name can only contain');
      expect(() => loadProfile(name)).toThrow('Profile name can only contain');
      expect(() => saveProfile({}, name)).toThrow('Profile name can only contain');
      expect(() => deleteProfile(name)).toThrow('Profile name can only contain');
      expect(() => setCurrentProfile(name)).toThrow('Profile name can only contain');
      expect(() => setProfileOverride(name)).toThrow('Profile name can only contain');
    }
  });

  test('ignores invalid current-profile file contents', () => {
    ensureConfigDir();
    writeFileSync(join(getConfigDir(), 'current_profile'), '../escape');

    expect(createProfile('safe')).toBe(true);
    expect(getCurrentProfile()).toBe('default');
  });

  test('loads and saves valid profiles only under the profile directory', () => {
    expect(createProfile('safe')).toBe(true);
    saveProfile({ apiKey: 'updated' }, 'safe');

    expect(profileExists('safe')).toBe(true);
    expect(loadProfile('safe')).toEqual({ apiKey: 'updated' });
    expect(deleteProfile('safe')).toBe(true);
    expect(profileExists('safe')).toBe(false);
  });
});

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}
