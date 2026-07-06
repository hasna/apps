import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig, saveConfig } from './config';

const originalHome = process.env.HOME;
const homes: string[] = [];

function useTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'connect-tensorboard-home-'));
  homes.push(home);
  process.env.HOME = home;
  return home;
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('TensorBoard CLI config', () => {
  test('loadConfig does not create config directories for read commands', () => {
    const home = useTempHome();
    const configDir = join(home, '.hasna', 'connectors', 'connect-tensorboard');

    expect(loadConfig()).toEqual({});
    expect(existsSync(configDir)).toBe(false);
  });

  test('saveConfig creates the config file for write commands', () => {
    const home = useTempHome();
    const configFile = join(home, '.hasna', 'connectors', 'connect-tensorboard', 'config.json');

    saveConfig({ baseUrl: 'http://localhost:6006' });

    expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toEqual({ baseUrl: 'http://localhost:6006' });
  });
});
