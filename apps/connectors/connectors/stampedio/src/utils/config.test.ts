import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getConfigDir,
  hasCredentials,
  setPrivateKey,
  setPublicKey,
  setStoreHash,
  setStoreUrl,
} from './config';

const realHome = process.env.HOME;
const tempHomes: string[] = [];

function useTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'connect-stampedio-home-'));
  tempHomes.push(home);
  process.env.HOME = home;
  return home;
}

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;

  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }

  delete process.env.STAMPEDIO_PUBLIC_KEY;
  delete process.env.STAMPEDIO_PRIVATE_KEY;
  delete process.env.STAMPEDIO_STORE_HASH;
  delete process.env.STAMPEDIO_STORE_URL;
});

describe('Stamped.io config storage', () => {
  test('profile files containing a private API key are written with owner-only mode', () => {
    const home = useTempHome();

    setPrivateKey('priv_456');
    setPublicKey('pub_123');
    setStoreHash('store789');
    setStoreUrl('demo.myshopify.com');

    expect(getConfigDir()).toBe(join(home, '.hasna', 'connectors', 'connect-stampedio'));
    expect(hasCredentials()).toBe(true);

    const profilePath = join(home, '.hasna', 'connectors', 'connect-stampedio', 'profiles', 'default.json');
    expect(statSync(profilePath).mode & 0o777).toBe(0o600);
  });

  test('private API credentials do not require a public widget key', () => {
    useTempHome();

    setPrivateKey('priv_456');
    setStoreHash('store789');

    expect(hasCredentials()).toBe(true);
  });
});
