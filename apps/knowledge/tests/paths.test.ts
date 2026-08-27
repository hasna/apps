import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { knowledgeAuthPath } from '../src/auth';
import {
  adoptResolverDataHome,
  getDataHome,
  getExactDataHome,
  getHomeDir,
  getLegacyDataHome,
  getResolverDataHome,
  KNOWLEDGE_DATA_HOME_ENV,
} from '../src/paths';
import { globalKnowledgeHome, projectKnowledgeHome, projectKey } from '../src/workspace';

const ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'HASNA_DATA_HOME',
  'HASNA_CACHE_HOME',
  'HASNA_CONFIG_HOME',
  'HASNA_STATE_HOME',
  'HASNA_KNOWLEDGE_HOME',
  'HASNA_KNOWLEDGE_AUTH_DIR',
  'HASNA_KNOWLEDGE_AUTH_PATH',
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (tempHome !== null) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

function isolateHome(): string {
  if (tempHome !== null) throw new Error('isolateHome called twice without afterEach');
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  tempHome = mkdtempSync(join(tmpdir(), 'knowledge-paths-'));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe('resolver (XDG) data-home resolution', () => {
  test('home resolves HOME first, then the OS user database', () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test('resolver data home follows @hasna/paths under a fake HOME', () => {
    const home = isolateHome();
    expect(getResolverDataHome()).toBe(join(home, '.local', 'share', 'hasna', 'knowledge'));
    expect(getLegacyDataHome()).toBe(join(home, '.hasna', 'knowledge'));
  });
});

describe('resolver (XDG) adoption — the legacy home must never become invisible', () => {
  test('legacy ~/.hasna/knowledge stays the effective home until adopted', () => {
    const home = isolateHome();
    expect(adoptResolverDataHome(getResolverDataHome())).toBe(false);
    expect(getDataHome()).toBe(getLegacyDataHome());
    // The downstream entry points all agree on the effective home.
    expect(globalKnowledgeHome()).toBe(join(home, '.hasna', 'knowledge'));
    expect(knowledgeAuthPath()).toBe(join(home, '.hasna', 'knowledge', 'auth.json'));
    expect(projectKnowledgeHome('/some/project')).toBe(
      join(home, '.hasna', 'knowledge', 'projects', projectKey('/some/project')),
    );
  });

  test('HASNA_DATA_HOME adopts the resolver (XDG) data home', () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), 'knowledge-data-home-'));
    cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataHome(getResolverDataHome())).toBe(true);
    expect(getDataHome()).toBe(join(base, 'knowledge'));
    expect(globalKnowledgeHome()).toBe(join(base, 'knowledge'));
    expect(knowledgeAuthPath()).toBe(join(base, 'knowledge', 'auth.json'));
    expect(projectKnowledgeHome('/some/project')).toBe(
      join(base, 'knowledge', 'projects', projectKey('/some/project')),
    );
  });

  test('an existing store at the resolver data home adopts it even without HASNA_DATA_HOME', () => {
    const home = isolateHome();
    const xdg = join(home, '.local', 'share', 'hasna', 'knowledge');
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, 'knowledge.db'), 'existing-migrated-store');
    expect(adoptResolverDataHome(getResolverDataHome())).toBe(true);
    expect(getDataHome()).toBe(xdg);
  });

  test('an existing config.json at the resolver data home adopts it even without HASNA_DATA_HOME', () => {
    const home = isolateHome();
    const xdg = join(home, '.local', 'share', 'hasna', 'knowledge');
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, 'config.json'), '{}');
    expect(adoptResolverDataHome(getResolverDataHome())).toBe(true);
    expect(getDataHome()).toBe(xdg);
  });

  test('a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home', () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), 'knowledge-cache-home-'));
    cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataHome(getResolverDataHome())).toBe(false);
    expect(getDataHome()).toBe(join(home, '.hasna', 'knowledge'));
  });

  test('HASNA_KNOWLEDGE_HOME exact override wins over both roots', () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), 'knowledge-hasna-home-'));
    cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), 'knowledge-data-home2-'));
    cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env[KNOWLEDGE_DATA_HOME_ENV] = override;
    expect(getExactDataHome()).toBe(override);
    expect(getDataHome()).toBe(override);
    expect(globalKnowledgeHome()).toBe(override);
    expect(knowledgeAuthPath()).toBe(join(override, 'auth.json'));
  });

  test('a whitespace-only HASNA_KNOWLEDGE_HOME falls through to the legacy root', () => {
    const home = isolateHome();
    process.env[KNOWLEDGE_DATA_HOME_ENV] = '   ';
    expect(getExactDataHome()).toBeUndefined();
    expect(getDataHome()).toBe(join(home, '.hasna', 'knowledge'));
  });

  test('exact data-home overrides are resolved to absolute paths', () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), 'knowledge-abs-'));
    cleanups.push(base);
    const raw = join(base, '..', 'knowledge-abs-rel');
    process.env[KNOWLEDGE_DATA_HOME_ENV] = raw;
    expect(getExactDataHome()).toBe(resolve(raw));
    expect(getExactDataHome()?.startsWith('/')).toBe(true);
  });
});
