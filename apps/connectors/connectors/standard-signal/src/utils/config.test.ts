import { describe, expect, test } from 'bun:test';
import {
  createProfile,
  deleteProfile,
  loadProfile,
  profileExists,
  setCurrentProfile,
  setProfileOverride,
} from './config';

describe('profile name validation', () => {
  const invalidProfile = '../../outside';
  const expectedError = 'Profile name can only contain letters, numbers, hyphens, and underscores';

  test('rejects invalid profile names before filesystem lookup', () => {
    expect(() => profileExists(invalidProfile)).toThrow(expectedError);
    expect(() => createProfile(invalidProfile)).toThrow(expectedError);
    expect(() => deleteProfile(invalidProfile)).toThrow(expectedError);
    expect(() => loadProfile(invalidProfile)).toThrow(expectedError);
    expect(() => setCurrentProfile(invalidProfile)).toThrow(expectedError);
    expect(() => setProfileOverride(invalidProfile)).toThrow(expectedError);
  });
});
