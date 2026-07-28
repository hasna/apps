/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Mode selection must be EXPLICIT. These tests exist because the opposite —
 * selecting the backend from the presence of an API URL and an API key — routed
 * a full test run's writes at the live store on any machine whose login shell
 * exported those two variables, and reported it as 99 unrelated test failures.
 *
 * Every case passes an explicit `env` object rather than mutating
 * `process.env`. `bun test` runs all files in one process, so a module-scope or
 * `beforeAll` assignment here would leak into every later file in the run —
 * which is exactly the leak this defect class travels on.
 */
import { describe, expect, test } from 'bun:test';
import {
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  KNOWLEDGE_MODE_ENV_KEYS,
  knowledgeModeReport,
  pinnedTransportEnv,
  resolveKnowledgeModeSelection,
} from '../src/knowledge-mode';
import { isKnowledgeApiMode, resolveKnowledgeCloudStore } from '../src/cloud-store';
import { resolveItemStore } from '../src/item-store';

/** A syntactically valid but fake pointer pair. Not a real endpoint, not a real key. */
const FAKE_URL = 'https://knowledge.invalid';
const FAKE_KEY = 'k_fake_test_key';

const POINTER_ONLY = {
  HASNA_KNOWLEDGE_API_URL: FAKE_URL,
  HASNA_KNOWLEDGE_API_KEY: FAKE_KEY,
} as NodeJS.ProcessEnv;

describe('knowledge mode selection is explicit, never inferred from a pointer', () => {
  test('the env key contract comes from @hasna/contracts, canonical key first', () => {
    expect(KNOWLEDGE_MODE_ENV_KEYS[0]).toBe('HASNA_KNOWLEDGE_STORAGE_MODE');
    expect([...KNOWLEDGE_MODE_ENV_KEYS]).toEqual([
      'HASNA_KNOWLEDGE_STORAGE_MODE',
      'HASNA_KNOWLEDGE_MODE',
      'KNOWLEDGE_STORAGE_MODE',
      'KNOWLEDGE_MODE',
    ]);
    expect([...KNOWLEDGE_API_URL_ENV_KEYS]).toEqual(['HASNA_KNOWLEDGE_API_URL', 'KNOWLEDGE_API_URL']);
    expect([...KNOWLEDGE_API_KEY_ENV_KEYS]).toEqual(['HASNA_KNOWLEDGE_API_KEY', 'KNOWLEDGE_API_KEY']);
  });

  test('an empty environment is local by default', () => {
    const resolved = resolveKnowledgeModeSelection({} as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('local');
    expect(resolved.source).toEqual({ kind: 'default', name: null, value: null });
    expect(resolved.pointer_env_present).toEqual([]);
    expect(resolved.pointer_ignored).toBe(false);
    expect(resolved.warning).toBeNull();
  });

  test('REGRESSION: url + key with no mode var stays LOCAL and says the pointers were ignored', () => {
    // The defect. Under the old resolver this environment — which is what an
    // ambient exported pair looks like — selected the cloud backend, so a test
    // suite that believed it was isolated wrote to the live store.
    const resolved = resolveKnowledgeModeSelection(POINTER_ONLY);
    expect(resolved.mode).toBe('local');
    expect(resolved.source.kind).toBe('default');
    expect(resolved.pointer_ignored).toBe(true);
    expect(resolved.pointer_env_present).toEqual(['HASNA_KNOWLEDGE_API_URL', 'HASNA_KNOWLEDGE_API_KEY']);
    // The note has to name the variable the operator must set, or "it went
    // local" is just as mysterious as "it went cloud" used to be.
    expect(resolved.warning).toContain('HASNA_KNOWLEDGE_STORAGE_MODE=cloud');
    expect(resolved.warning).toContain('HASNA_KNOWLEDGE_API_URL');
  });

  test('REGRESSION: the alias pointer keys do not select cloud either', () => {
    const resolved = resolveKnowledgeModeSelection({
      KNOWLEDGE_API_URL: FAKE_URL,
      KNOWLEDGE_API_KEY: FAKE_KEY,
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('local');
    expect(resolved.pointer_env_present).toEqual(['KNOWLEDGE_API_URL', 'KNOWLEDGE_API_KEY']);
  });

  test('an explicit cloud mode selects cloud and names the key that did it', () => {
    const resolved = resolveKnowledgeModeSelection({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('cloud');
    expect(resolved.source).toEqual({ kind: 'env', name: 'HASNA_KNOWLEDGE_STORAGE_MODE', value: 'cloud' });
    expect(resolved.pointer_ignored).toBe(false);
    expect(resolved.warning).toBeNull();
  });

  test('an explicit local mode outranks the pointers', () => {
    const resolved = resolveKnowledgeModeSelection({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('local');
    expect(resolved.source.name).toBe('HASNA_KNOWLEDGE_STORAGE_MODE');
    expect(resolved.pointer_ignored).toBe(true);
  });

  test('the first mode key wins and the later ones are not consulted', () => {
    const resolved = resolveKnowledgeModeSelection({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
      HASNA_KNOWLEDGE_MODE: 'cloud',
      KNOWLEDGE_MODE: 'cloud',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('local');
    expect(resolved.source.name).toBe('HASNA_KNOWLEDGE_STORAGE_MODE');
  });

  test('an alias mode key still selects, and says it is an alias', () => {
    const resolved = resolveKnowledgeModeSelection({ KNOWLEDGE_MODE: 'cloud' } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('cloud');
    expect(resolved.source.name).toBe('KNOWLEDGE_MODE');
    expect(resolved.warning).toContain('canonical key is HASNA_KNOWLEDGE_STORAGE_MODE');
  });

  test("the deprecated 'self_hosted' value normalizes to cloud with a note", () => {
    const resolved = resolveKnowledgeModeSelection({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('cloud');
    expect(resolved.warning).toContain("Deprecated mode 'self_hosted'");
  });

  test('whitespace-only mode vars are treated as unset, not as an error', () => {
    const resolved = resolveKnowledgeModeSelection({
      HASNA_KNOWLEDGE_STORAGE_MODE: '   ',
      KNOWLEDGE_MODE: 'cloud',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('cloud');
    expect(resolved.source.name).toBe('KNOWLEDGE_MODE');
  });

  test('an unusable mode value throws and names the offending variable', () => {
    expect(() =>
      resolveKnowledgeModeSelection({ HASNA_KNOWLEDGE_MODE: 'hosted' } as NodeJS.ProcessEnv),
    ).toThrow('HASNA_KNOWLEDGE_MODE=hosted');
  });
});

describe('the resolved mode reaches the real store resolvers', () => {
  test('resolveItemStore returns the LOCAL transport under a pointer-only env', () => {
    // Asserted through the resolver every item command actually calls, not by
    // reasoning about the environment: the mode is only fixed once this returns.
    const store = resolveItemStore({
      storePath: '/tmp/knowledge-mode-test-does-not-exist/db.json',
      storePathOverridden: false,
      env: POINTER_ONLY,
    });
    expect(store.kind).toBe('local');
    expect(store.location).not.toMatch(/^https?:/);
  });

  test('resolveItemStore returns the API transport when the mode is explicitly cloud', () => {
    const store = resolveItemStore({
      storePath: '/tmp/knowledge-mode-test-does-not-exist/db.json',
      storePathOverridden: false,
      env: { ...POINTER_ONLY, HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud' } as NodeJS.ProcessEnv,
    });
    expect(store.kind).toBe('api');
    expect(store.location).toBe(`${FAKE_URL}/v1`);
  });

  test('isKnowledgeApiMode and resolveKnowledgeCloudStore agree with the selection', () => {
    expect(isKnowledgeApiMode(POINTER_ONLY)).toBe(false);
    expect(resolveKnowledgeCloudStore(POINTER_ONLY)).toBeNull();
    const cloudEnv = { ...POINTER_ONLY, HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud' } as NodeJS.ProcessEnv;
    expect(isKnowledgeApiMode(cloudEnv)).toBe(true);
    expect(resolveKnowledgeCloudStore(cloudEnv)).not.toBeNull();
  });

  test('pinnedTransportEnv overwrites an ambient mode var in both directions', () => {
    // This is what stops @hasna/contracts from re-deriving cloud from the
    // pointers after we have decided the answer is local.
    expect(pinnedTransportEnv(POINTER_ONLY, 'local').HASNA_KNOWLEDGE_STORAGE_MODE).toBe('local');
    expect(
      pinnedTransportEnv({ HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud' } as NodeJS.ProcessEnv, 'local')
        .HASNA_KNOWLEDGE_STORAGE_MODE,
    ).toBe('local');
    expect(pinnedTransportEnv(POINTER_ONLY, 'cloud').HASNA_KNOWLEDGE_STORAGE_MODE).toBe('cloud');
  });
});

describe('the mode report is safe to print', () => {
  test('reports the resolved backend, the guard state, and pointer NAMES only', () => {
    const report = knowledgeModeReport({ ...POINTER_ONLY, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(report.mode).toBe('local');
    expect(report.store_transport).toBe('local');
    expect(report.api_key_present).toBe(true);
    expect(report.network_guard_active).toBe(true);

    // The whole serialized report must not carry either pointer VALUE: this
    // object is printed by `knowledge mode` and pasted into task comments.
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain(FAKE_URL);
    expect(serialized).toContain('HASNA_KNOWLEDGE_API_KEY');
  });

  test('reports cloud when cloud is selected, and no guard outside test', () => {
    const report = knowledgeModeReport({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    expect(report.mode).toBe('cloud');
    expect(report.store_transport).toBe('api');
    expect(report.network_guard_active).toBe(false);
  });
});
