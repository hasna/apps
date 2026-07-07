import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getApiKey, getConfigDir, listProfiles, profileExists, setProfileOverride } from './config';

const originalHome = process.env.HOME;
const originalApiKey = process.env.TICKETMASTER_API_KEY;
let tempHome: string | undefined;

function useTempHome(): string {
  tempHome = mkdtempSync(join(tmpdir(), 'ticketmaster-config-'));
  process.env.HOME = tempHome;
  delete process.env.TICKETMASTER_API_KEY;
  setProfileOverride(undefined);
  return tempHome;
}

afterEach(() => {
  setProfileOverride(undefined);
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalApiKey === undefined) {
    delete process.env.TICKETMASTER_API_KEY;
  } else {
    process.env.TICKETMASTER_API_KEY = originalApiKey;
  }
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

describe('Ticketmaster config', () => {
  test('reads shared auth config written by the root connectors auth flow', () => {
    const home = useTempHome();
    const sharedProfileDir = join(home, '.hasna', 'connectors', 'ticketmaster', 'profiles', 'default');
    mkdirSync(sharedProfileDir, { recursive: true });
    writeFileSync(join(sharedProfileDir, 'config.json'), JSON.stringify({ apiKey: 'shared-auth-key' }));

    expect(getApiKey()).toBe('shared-auth-key');
    expect(profileExists('default')).toBe(true);
    expect(listProfiles()).toContain('default');
    expect(getConfigDir()).toBe(join(home, '.hasna', 'connectors', 'connect-ticketmaster'));
  });
});
