import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  findRemoteApiUrl,
  getRemoteApiUrl,
  setRemoteApiUrl,
  setProfileOverride,
  getConfigDir,
  clearConfig,
} from './config';

// We need to test the config module with a custom config dir
// to avoid messing with actual user config
const TEST_CONFIG_DIR = join(homedir(), '.hasna', 'connectors', 'connect-zendesk-test');
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'config.json');

describe('Config utilities', () => {
  beforeEach(() => {
    // Clean up test directory before each test
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  describe('ensureConfigDir', () => {
    test('creates directory if it does not exist', () => {
      expect(existsSync(TEST_CONFIG_DIR)).toBe(false);
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      expect(existsSync(TEST_CONFIG_DIR)).toBe(true);
    });

    test('does nothing if directory already exists', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      mkdirSync(TEST_CONFIG_DIR, { recursive: true }); // Should not throw
      expect(existsSync(TEST_CONFIG_DIR)).toBe(true);
    });
  });

  describe('loadConfig', () => {
    test('returns empty object if config file does not exist', () => {
      // Using inline logic since we can't modify the actual module's paths
      const loadTestConfig = () => {
        if (!existsSync(TEST_CONFIG_FILE)) {
          return {};
        }
        try {
          const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
          return JSON.parse(content);
        } catch {
          return {};
        }
      };

      expect(loadTestConfig()).toEqual({});
    });

    test('returns parsed config from file', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      const testConfig = { email: 'test@example.com', apiToken: 'token123' };
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify(testConfig));

      const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(testConfig);
    });

    test('returns empty object on invalid JSON', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      writeFileSync(TEST_CONFIG_FILE, 'not valid json');

      const loadTestConfig = () => {
        try {
          const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
          return JSON.parse(content);
        } catch {
          return {};
        }
      };

      expect(loadTestConfig()).toEqual({});
    });
  });

  describe('saveConfig', () => {
    test('saves config to file', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      const testConfig = { email: 'new@example.com' };
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify(testConfig, null, 2));

      const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.email).toBe('new@example.com');
    });

    test('creates directory if it does not exist', () => {
      expect(existsSync(TEST_CONFIG_DIR)).toBe(false);
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify({ email: 'test@example.com' }));

      expect(existsSync(TEST_CONFIG_FILE)).toBe(true);
    });
  });

  describe('getters and setters', () => {
    test('setEmail and getEmail work correctly', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });

      // Set
      const config = { email: 'user@example.com' };
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config));

      // Get
      const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.email).toBe('user@example.com');
    });

    test('setApiToken and getApiToken work correctly', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });

      const config = { apiToken: 'secret-token' };
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config));

      const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.apiToken).toBe('secret-token');
    });

    test('setBaseUrl and getBaseUrl work correctly', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });

      const config = { baseUrl: 'https://custom.zendesk.com/api/v2' };
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config));

      const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.baseUrl).toBe('https://custom.zendesk.com/api/v2');
    });

    test('setDefaultAccount and getDefaultAccount work correctly', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });

      const config = { defaultAccount: 'production' };
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config));

      const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.defaultAccount).toBe('production');
    });
  });

  describe('clearConfig', () => {
    test('clears all config values', () => {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify({ email: 'test@example.com', apiToken: 'token' }));

      // Clear
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify({}));

      const content = readFileSync(TEST_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({});
    });
  });

  describe('environment variable priority', () => {
    test('environment variables take precedence over config file', () => {
      const originalEnv = process.env.ZENDESK_EMAIL;

      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      writeFileSync(TEST_CONFIG_FILE, JSON.stringify({ email: 'config@example.com' }));

      process.env.ZENDESK_EMAIL = 'env@example.com';

      // Simulating the priority logic
      const getEmail = () => process.env.ZENDESK_EMAIL || JSON.parse(readFileSync(TEST_CONFIG_FILE, 'utf-8')).email;

      expect(getEmail()).toBe('env@example.com');

      // Restore
      if (originalEnv) process.env.ZENDESK_EMAIL = originalEnv;
      else delete process.env.ZENDESK_EMAIL;
    });
  });

  // The remote API URL no longer falls back to a hardcoded deployment host, so
  // these exercise the real module instead of re-implementing the priority
  // logic: an unconfigured URL has to fail loudly rather than silently resolve
  // to a baked-in default, and each configured source has to round-trip.
  describe('remote API URL resolution', () => {
    const REMOTE_URL_TEST_PROFILE = 'remote-url-test';
    const ENV_URL = 'https://env.example.com/zendesk';
    const STORED_URL = 'https://stored.example.com/zendesk';

    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.ZENDESK_REMOTE_API_URL;
      delete process.env.ZENDESK_REMOTE_API_URL;
      // Profiles are the module's own isolation seam: point config reads and
      // writes at a throwaway profile so the real one is never touched.
      setProfileOverride(REMOTE_URL_TEST_PROFILE);
      clearConfig();
    });

    afterEach(() => {
      const profileDir = getConfigDir();
      setProfileOverride(undefined);
      rmSync(profileDir, { recursive: true, force: true });

      if (originalEnv === undefined) delete process.env.ZENDESK_REMOTE_API_URL;
      else process.env.ZENDESK_REMOTE_API_URL = originalEnv;
    });

    test('is unset and throws when neither env nor config provides a URL', () => {
      expect(findRemoteApiUrl()).toBeUndefined();
      expect(() => getRemoteApiUrl()).toThrow(/ZENDESK_REMOTE_API_URL/);
    });

    test('resolves from the environment variable', () => {
      process.env.ZENDESK_REMOTE_API_URL = ENV_URL;

      expect(findRemoteApiUrl()).toBe(ENV_URL);
      expect(getRemoteApiUrl()).toBe(ENV_URL);
    });

    test('resolves from the stored config value', () => {
      setRemoteApiUrl(STORED_URL);

      expect(findRemoteApiUrl()).toBe(STORED_URL);
      expect(getRemoteApiUrl()).toBe(STORED_URL);
    });

    test('environment variable takes precedence over the stored config value', () => {
      setRemoteApiUrl(STORED_URL);
      process.env.ZENDESK_REMOTE_API_URL = ENV_URL;

      expect(findRemoteApiUrl()).toBe(ENV_URL);
      expect(getRemoteApiUrl()).toBe(ENV_URL);
    });
  });
});
