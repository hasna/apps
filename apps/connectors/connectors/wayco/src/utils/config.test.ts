import { describe, expect, test } from 'bun:test';
import { createProfile, isValidProfileName, loadProfile, profileExists } from './config';

describe('Wayco profile config safety', () => {
  test('validates profile names before using filesystem paths', () => {
    expect(isValidProfileName('default')).toBe(true);
    expect(isValidProfileName('law-firm_1')).toBe(true);
    expect(isValidProfileName('../outside')).toBe(false);
    expect(isValidProfileName('nested/profile')).toBe(false);
    expect(profileExists('../outside')).toBe(false);
    expect(() => createProfile('../outside')).toThrow('Profile name can only contain');
    expect(() => loadProfile('../outside')).toThrow('Profile name can only contain');
  });
});
