import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_API_KEY_ENV,
  KNOWLEDGE_API_URL_ENV,
  KNOWLEDGE_LOCAL_OPT_IN_ENV,
  resetKnowledgeLocalModeNotice,
} from '../src/client-transport';
import { createKnowledgeClient } from '../src/sdk';
import { createKnowledgeService } from '../src/service';
import { KNOWLEDGE_TEST_ROUTE_ENV_KEYS } from './preload';

// ============================================================================
// `KnowledgeService.itemStore()` is the one item surface behind the CLI, the
// MCP tools and `./sdk` (`client.items.*`). It must resolve the transport
// BEFORE creating the workspace skeleton: a hosted read, or a read that fails
// closed, must not leave `config.json` and eight directories under
// ~/.hasna/knowledge as a side effect (hasna/apps#1720 acceptance (c)/(f)).
// The store resolves against the live process.env (the Keychain tier is
// ambient), so these tests set and restore process.env around each case; the
// Keychain tier is closed by the HASNA_STATION sentinel and, under bun test,
// by the NODE_ENV=test network guard.
// ============================================================================

const ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'HASNA_STATION',
  KNOWLEDGE_LOCAL_OPT_IN_ENV,
  ...KNOWLEDGE_TEST_ROUTE_ENV_KEYS,
] as const;

const API_URL = 'https://knowledge.invalid';

let saved: Record<string, string | undefined> = {};
let home = '';
let cwd = '';

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  home = mkdtempSync(join(tmpdir(), 'knowledge-itemstore-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'knowledge-itemstore-cwd-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HASNA_STATION = 'no-such-station';
  resetKnowledgeLocalModeNotice();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function onBoxRoot(): string {
  return join(home, '.hasna', 'knowledge');
}

describe('KnowledgeService.itemStore() resolves the transport before touching the workspace', () => {
  test('FAILING INPUT: no credential and no opt-in throws the fail-closed diagnostic and creates nothing on-box', () => {
    const service = createKnowledgeService({ scope: 'project', cwd });

    expect(() => service.itemStore()).toThrow(/no local fallback/);

    // No config.json, no directories, no *.db: the sandbox HOME is untouched.
    expect(existsSync(onBoxRoot())).toBe(false);
    expect(service.paths().config_exists).toBe(false);
  });

  test('the ./sdk item surface fails closed the same way — store(), list() and get() — and creates nothing', async () => {
    const client = createKnowledgeClient({ scope: 'project', cwd });

    expect(() => client.items.store()).toThrow(/no local fallback/);
    await expect(client.items.list()).rejects.toThrow(/no local fallback/);
    await expect(client.items.get('k_missing')).rejects.toThrow(/no local fallback/);

    expect(existsSync(onBoxRoot())).toBe(false);
  });

  test('a hosted resolution (env credential) returns the API store without writing the workspace skeleton', () => {
    process.env[KNOWLEDGE_API_URL_ENV] = API_URL;
    process.env[KNOWLEDGE_API_KEY_ENV] = 'k_fake_test_key';
    const service = createKnowledgeService({ scope: 'project', cwd });

    const store = service.itemStore();

    expect(store.kind).toBe('api');
    expect(store.location).toBe(`${API_URL}/v1`);
    expect(existsSync(onBoxRoot())).toBe(false);
    expect(service.paths().config_exists).toBe(false);
  });

  test('control: the explicit HASNA_KNOWLEDGE_LOCAL=1 opt-in returns the on-box store and creates its workspace', () => {
    process.env[KNOWLEDGE_LOCAL_OPT_IN_ENV] = '1';
    const service = createKnowledgeService({ scope: 'project', cwd });

    const store = service.itemStore();

    expect(store.kind).toBe('local');
    expect(store.location).toBe(service.workspace.jsonStorePath);
    expect(existsSync(service.workspace.configPath)).toBe(true);
    expect(service.paths().config_exists).toBe(true);
  });
});
