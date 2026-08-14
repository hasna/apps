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
  HalfConfiguredKnowledgeClientError,
  KNOWLEDGE_API_KEY_ENV_KEYS,
  KNOWLEDGE_API_URL_ENV_KEYS,
  KNOWLEDGE_MODE_ENV_KEYS,
  LOCAL_MODE_CANDIDATES,
  SERVER_MODE_CANDIDATES,
  assertKnowledgeModeSelected,
  contractsStorageModeFor,
  knowledgeModeReport,
  localStorageMode,
  pinnedTransportEnv,
  resolveKnowledgeModeSelection,
  serverStorageMode,
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

  test('an empty environment is sqlite by default', () => {
    const resolved = resolveKnowledgeModeSelection({} as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('sqlite');
    expect(resolved.source).toEqual({ kind: 'default', name: null, value: null });
    expect(resolved.pointer_env_present).toEqual([]);
    expect(resolved.pointer_ignored).toBe(false);
    expect(resolved.warning).toBeNull();
  });

  test('REGRESSION: url + key with no mode var stays sqlite and says the pointers were ignored', () => {
    // The defect. Under the old resolver this environment — which is what an
    // ambient exported pair looks like — selected the cloud backend, so a test
    // suite that believed it was isolated wrote to the live store.
    const resolved = resolveKnowledgeModeSelection(POINTER_ONLY);
    expect(resolved.mode).toBe('sqlite');
    expect(resolved.source.kind).toBe('default');
    expect(resolved.pointer_ignored).toBe(true);
    expect(resolved.pointer_env_present).toEqual(['HASNA_KNOWLEDGE_API_URL', 'HASNA_KNOWLEDGE_API_KEY']);
    // The note has to name the variable the operator must set, or "it went
    // local" is just as mysterious as "it went cloud" used to be.
    expect(resolved.warning).toContain('HASNA_KNOWLEDGE_STORAGE_MODE=postgres');
    expect(resolved.warning).toContain('HASNA_KNOWLEDGE_API_URL');
  });

  test('REGRESSION: the alias pointer keys do not select postgres either', () => {
    const resolved = resolveKnowledgeModeSelection({
      KNOWLEDGE_API_URL: FAKE_URL,
      KNOWLEDGE_API_KEY: FAKE_KEY,
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('sqlite');
    expect(resolved.pointer_env_present).toEqual(['KNOWLEDGE_API_URL', 'KNOWLEDGE_API_KEY']);
  });

  test('an explicit postgres backend selects the API and names the key that did it', () => {
    const resolved = resolveKnowledgeModeSelection({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('postgres');
    expect(resolved.source).toEqual({ kind: 'env', name: 'HASNA_KNOWLEDGE_STORAGE_MODE', value: 'postgres' });
    expect(resolved.pointer_ignored).toBe(false);
    expect(resolved.warning).toBeNull();
  });

  test('an explicit sqlite backend outranks the pointers', () => {
    const resolved = resolveKnowledgeModeSelection({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'sqlite',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('sqlite');
    expect(resolved.source.name).toBe('HASNA_KNOWLEDGE_STORAGE_MODE');
    expect(resolved.pointer_ignored).toBe(true);
  });

  test('the first mode key wins and the later ones are not consulted', () => {
    const resolved = resolveKnowledgeModeSelection({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'sqlite',
      HASNA_KNOWLEDGE_MODE: 'postgres',
      KNOWLEDGE_MODE: 'postgres',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('sqlite');
    expect(resolved.source.name).toBe('HASNA_KNOWLEDGE_STORAGE_MODE');
  });

  test('an alias mode key still selects, and says it is an alias', () => {
    const resolved = resolveKnowledgeModeSelection({ KNOWLEDGE_MODE: 'postgres' } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('postgres');
    expect(resolved.source.name).toBe('KNOWLEDGE_MODE');
    expect(resolved.warning).toContain('canonical key is HASNA_KNOWLEDGE_STORAGE_MODE');
  });

  test('removed placement words are rejected instead of normalized', () => {
    expect(() =>
      resolveKnowledgeModeSelection({
        ...POINTER_ONLY,
        HASNA_KNOWLEDGE_STORAGE_MODE: 'self_hosted',
      } as NodeJS.ProcessEnv),
    ).toThrow(/runtime-placement axis was removed/);
    expect(() =>
      resolveKnowledgeModeSelection({ HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud' } as NodeJS.ProcessEnv),
    ).toThrow(/runtime-placement axis was removed/);
    expect(() =>
      resolveKnowledgeModeSelection({ HASNA_KNOWLEDGE_STORAGE_MODE: 'local' } as NodeJS.ProcessEnv),
    ).toThrow(/runtime-placement axis was removed/);
  });

  test('whitespace-only mode vars are treated as unset, not as an error', () => {
    const resolved = resolveKnowledgeModeSelection({
      HASNA_KNOWLEDGE_STORAGE_MODE: '   ',
      KNOWLEDGE_MODE: 'postgres',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('postgres');
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

  test('resolveItemStore returns the API transport when the backend is explicitly postgres', () => {
    const store = resolveItemStore({
      storePath: '/tmp/knowledge-mode-test-does-not-exist/db.json',
      storePathOverridden: false,
      env: { ...POINTER_ONLY, HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres' } as NodeJS.ProcessEnv,
    });
    expect(store.kind).toBe('api');
    expect(store.location).toBe(`${FAKE_URL}/v1`);
  });

  test('isKnowledgeApiMode and resolveKnowledgeCloudStore agree with the selection', () => {
    expect(isKnowledgeApiMode(POINTER_ONLY)).toBe(false);
    expect(resolveKnowledgeCloudStore(POINTER_ONLY)).toBeNull();
    const postgresEnv = { ...POINTER_ONLY, HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres' } as NodeJS.ProcessEnv;
    expect(isKnowledgeApiMode(postgresEnv)).toBe(true);
    expect(resolveKnowledgeCloudStore(postgresEnv)).not.toBeNull();
  });

  test('pinnedTransportEnv overwrites an ambient mode var in both directions', () => {
    // This is what stops @hasna/contracts from re-deriving cloud from the
    // pointers after we have decided the answer is local.
    //
    // Compared against the DERIVED token, not against the literals 'local' and
    // 'cloud' this test used to hardcode. Those literals are only correct on one
    // generation of @hasna/contracts, so asserting them would have turned this
    // test into a second place the enum change has to be edited.
    expect(pinnedTransportEnv(POINTER_ONLY, 'sqlite').HASNA_KNOWLEDGE_STORAGE_MODE).toBe(
      localStorageMode(),
    );
    expect(
      pinnedTransportEnv({ HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres' } as NodeJS.ProcessEnv, 'sqlite')
        .HASNA_KNOWLEDGE_STORAGE_MODE,
    ).toBe(localStorageMode());
    expect(pinnedTransportEnv(POINTER_ONLY, 'postgres').HASNA_KNOWLEDGE_STORAGE_MODE).toBe(
      serverStorageMode(),
    );
    // The overwrite is real in both directions: local and server must not
    // collapse to the same token.
    expect(localStorageMode()).not.toBe(serverStorageMode());
  });
});

describe('the mode report is safe to print', () => {
  test('reports the resolved backend, the guard state, and pointer NAMES only', () => {
    const report = knowledgeModeReport({ ...POINTER_ONLY, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(report.mode).toBe('sqlite');
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

  test('reports api transport when postgres is selected, and no guard outside test', () => {
    const report = knowledgeModeReport({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    expect(report.mode).toBe('postgres');
    expect(report.store_transport).toBe('api');
    expect(report.network_guard_active).toBe(false);
  });
});

/**
 * The half-configured client.
 *
 * The block above locks in the RESOLUTION: a pointer never selects the backend,
 * so an ambient `HASNA_KNOWLEDGE_API_URL` cannot silently route writes at the
 * live store. That was the right call and it stays.
 *
 * What it left behind is the mirror-image failure. An operator who exports the
 * URL *on purpose* and forgets the mode var gets the on-box store, and every
 * command answers `{"ok": true, "total": 0, "items": []}` with exit 0 — a
 * silent empty result on a machine that is explicitly pointed at a store
 * holding 869 entries. Only `knowledge mode` ever mentioned it, and nobody runs
 * `knowledge mode` before trusting a list.
 *
 * Both silent readings are wrong for the same reason: the environment is
 * AMBIGUOUS and the client picked an answer instead of saying so. Naming the
 * variable is the only response that is not a guess.
 */
describe('a half-configured client refuses to guess which store it is on', () => {
  const URL_ONLY = { HASNA_KNOWLEDGE_API_URL: FAKE_URL } as NodeJS.ProcessEnv;

  test('REGRESSION: a URL pointer with no mode var is an error, not a silent local read', () => {
    // On 0.2.92 this returned the local store and exit 0. The measured symptom
    // was 98 entries where the configured store held 869.
    expect(() => assertKnowledgeModeSelected(POINTER_ONLY)).toThrow(HalfConfiguredKnowledgeClientError);
  });

  test('the error names the variable that is set and BOTH ways out', () => {
    let caught: unknown;
    try {
      assertKnowledgeModeSelected(POINTER_ONLY);
    } catch (error) {
      caught = error;
    }
    const message = (caught as Error).message;
    // The URL var that provoked it, so the operator knows which config is live.
    expect(message).toContain('HASNA_KNOWLEDGE_API_URL');
    // Both remedies. An error that only offers `=postgres` reads as "you must go
    // to the API", and an operator who wanted the on-box store would unset a
    // variable they need for other tools instead of pinning the mode.
    expect(message).toContain('HASNA_KNOWLEDGE_STORAGE_MODE=postgres');
    expect(message).toContain('HASNA_KNOWLEDGE_STORAGE_MODE=sqlite');
    expect((caught as { code?: string }).code).toBe('knowledge_mode_unset_with_api_url');
  });

  test('the error carries pointer NAMES only, never a URL or a key value', () => {
    // This message goes to stderr, into agent transcripts, and into task
    // comments. One of the vars it talks about holds a bearer key.
    let message = '';
    try {
      assertKnowledgeModeSelected(POINTER_ONLY);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(FAKE_KEY);
    expect(message).not.toContain(FAKE_URL);
  });

  test('an alias URL key provokes it too, and is the one named', () => {
    let message = '';
    try {
      assertKnowledgeModeSelected({ KNOWLEDGE_API_URL: FAKE_URL } as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('KNOWLEDGE_API_URL');
  });

  test('an explicit postgres backend is unambiguous and passes', () => {
    const resolved = assertKnowledgeModeSelected({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('postgres');
  });

  test('an explicit sqlite backend is unambiguous and passes — the pointer stays ignored', () => {
    // The escape hatch for a machine whose shell exports the URL for other
    // tooling. Saying `local` out loud is cheap; being guessed at is not.
    const resolved = assertKnowledgeModeSelected({
      ...POINTER_ONLY,
      HASNA_KNOWLEDGE_STORAGE_MODE: 'sqlite',
    } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('sqlite');
  });

  test('an API key with no URL is NOT ambiguous — there is no second store named', () => {
    // A key on its own points at nothing. Erroring here would fire on machines
    // that can never have routed anywhere, which is how a loud check gets
    // switched off.
    const resolved = assertKnowledgeModeSelected({ HASNA_KNOWLEDGE_API_KEY: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(resolved.mode).toBe('sqlite');
  });

  test('an explicit --store override is an explicit local choice and passes', () => {
    const resolved = assertKnowledgeModeSelected(POINTER_ONLY, { storePathOverridden: true });
    expect(resolved.mode).toBe('sqlite');
  });

  test('an empty environment is still fine', () => {
    expect(assertKnowledgeModeSelected({} as NodeJS.ProcessEnv).mode).toBe('sqlite');
  });

  test('the pure resolver is UNCHANGED — it still answers local without throwing', () => {
    // The guard is a separate gate on top of the resolution, deliberately. The
    // `mode` reporter has to keep working in exactly the environment the guard
    // rejects, or the command that explains the problem dies with it.
    expect(resolveKnowledgeModeSelection(POINTER_ONLY).mode).toBe('sqlite');
    expect(knowledgeModeReport(URL_ONLY).pointer_ignored).toBe(true);
  });
});

// -- The backend token boundary ----------------------------------------------
//
// The vendored kit and the live contracts package now share the same
// sqlite|postgres backend vocabulary. These tests keep the tiny derivation seam
// honest: the accepted tokens are checked against the installed normalizer, and
// an unrecognized future enum fails loudly instead of guessing.

describe('the live-contracts token is derived, never hardcoded', () => {
  const acceptOnly = (accepted: readonly string[]) => (value: string) => {
    if (!accepted.includes(value)) throw new Error(`Unknown storage mode: ${value}`);
    return value;
  };

  const CURRENT = ['sqlite', 'postgres', 'postgresql'];

  // Widened so `toContain` compares strings rather than narrowing to the tuple.
  const SERVER: readonly string[] = SERVER_MODE_CANDIDATES;
  const LOCAL: readonly string[] = LOCAL_MODE_CANDIDATES;

  test('derives the current backend tokens', () => {
    expect(serverStorageMode(acceptOnly(CURRENT))).toBe('postgres');
    expect(localStorageMode(acceptOnly(CURRENT))).toBe('sqlite');
  });

  test('throws with an actionable message when the enum changes again', () => {
    // Guessing is the defect class this module exists to remove, so an
    // unrecognised enum must fail loudly rather than fall through to a wrong
    // store.
    const rejectAll = acceptOnly([]);

    expect(() => serverStorageMode(rejectAll)).toThrow(/no known storage token/i);
    expect(() => serverStorageMode(rejectAll)).toThrow(/SERVER_MODE_CANDIDATES/);
    expect(() => localStorageMode(rejectAll)).toThrow(/LOCAL_MODE_CANDIDATES/);
  });

  test('an injected normalizer never poisons the cached default', () => {
    // The cache is keyed per candidate list and only read/written for the
    // default normalizer. Without that guard the first injected probe would fix
    // the value for the whole process.
    const realServer = serverStorageMode();
    const realLocal = localStorageMode();

    expect(serverStorageMode(acceptOnly(CURRENT))).toBe('postgres');
    expect(localStorageMode(acceptOnly(CURRENT))).toBe('sqlite');

    expect(serverStorageMode()).toBe(realServer);
    expect(localStorageMode()).toBe(realLocal);
  });

  test('agrees with the contracts version actually installed', () => {
    // Not a tautology: this is the assertion that fails the day a dependency
    // bump lands a generation the candidate lists do not cover.
    expect(SERVER).toContain(serverStorageMode());
    expect(LOCAL).toContain(localStorageMode());
  });

  test('contractsStorageModeFor maps the semantic mode, not the literal', () => {
    expect(contractsStorageModeFor('postgres')).toBe(serverStorageMode());
    expect(contractsStorageModeFor('sqlite')).toBe(localStorageMode());
    expect(contractsStorageModeFor('postgres', acceptOnly(CURRENT))).toBe('postgres');
    expect(contractsStorageModeFor('sqlite', acceptOnly(CURRENT))).toBe('sqlite');
  });

  test('the operator vocabulary is the generated backend vocabulary', () => {
    const resolution = resolveKnowledgeModeSelection({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
    } as NodeJS.ProcessEnv);

    expect(resolution.mode).toBe('postgres');
    expect(resolution.source.value).toBe('postgres');
    expect(knowledgeModeReport({ HASNA_KNOWLEDGE_STORAGE_MODE: 'sqlite' } as NodeJS.ProcessEnv).mode).toBe(
      'sqlite',
    );
  });
});
