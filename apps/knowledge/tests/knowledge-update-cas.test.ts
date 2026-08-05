/**
 * Regression test for todos task 97d26f1b — a measured P1 data-loss defect.
 *
 * `knowledge update --content` was an UNCONDITIONAL whole-content overwrite on
 * the local JSON store: it carried no version at all, so a write computed from
 * a stale read succeeded at rc=0 and silently destroyed an intervening write
 * from a second agent. The version counter the CLI already prints (from
 * `knowledge get`) kept incrementing right through the loss, so the one field
 * that would reveal a clobber was the one that made it look healthy.
 *
 * Fixed by:
 *   - a real, lock-protected version counter on LocalItemStore (item-store.ts),
 *     distinct from version HISTORY (`supportsVersions` stays false — no
 *     retained prior bodies; see VersionHistoryUnsupportedError);
 *   - an optional `--if-version <n>` CLI flag that lets a caller assert the
 *     version it ACTUALLY read, rather than the version `update` happens to
 *     re-read for its own internal patch (which only guards the instant
 *     inside one invocation and can never catch a stale EARLIER read).
 *
 * Every test in this file either talks to the store abstraction directly with
 * an explicit `--store`-equivalent (`storePathOverridden: true`) or spawns the
 * CLI with an isolated `HOME` and an explicit `--store`, per the fleet rule
 * against tests writing fixture rows into the real/hosted knowledge store.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeVersionConflictError } from '../src/cloud-store';
import { resolveItemStore, type ItemStore } from '../src/item-store';

/**
 * `knowledge add` requires --description from 2026-08-05 (owner directive; see
 * src/knowledge-taxonomy.ts). These tests exercise other behaviour, so they
 * pass one shared description rather than asserting anything about it.
 */
const CLI_TEST_DESCRIPTION = 'Fixture item created by a CLI test that predates the required description field.';


/**
 * Descriptions are REQUIRED on every create from 2026-08-05 (owner directive;
 * see src/knowledge-taxonomy.ts). These tests are about versioning and
 * concurrency rather than about the description, so they use one shared
 * constant: it satisfies the write guard without implying the value is under
 * test here.
 */
const TEST_DESCRIPTION = 'Fixture item used by the entry-versioning and concurrency tests.';


const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function localStore(dir: string): ItemStore {
  const path = join(dir, 'db.json');
  return resolveItemStore({ storePath: path, storePathOverridden: true });
}

/**
 * Spawn the CLI ASYNCHRONOUSLY (matches the sibling versioning test's own
 * rationale: never `spawnSync` a child whose completion this process might
 * ever need to await concurrently with other I/O).
 *
 * ISOLATION, per the hard constraint on this task:
 *   - `HOME`/`USERPROFILE` are always replaced with a fresh temp dir, so
 *     `os.homedir()` — and therefore the CLI's DEFAULT store path — can never
 *     resolve into whatever real knowledge store exists on the machine
 *     running this suite.
 *   - every ambient `*KNOWLEDGE*` env var is stripped, so a shell that
 *     happens to export cloud pointers does not leak into the child.
 *   - every call in this file ALSO passes an explicit `--store`, which
 *     independently forces the local transport regardless of any cloud env
 *     (see `resolveItemStore` in src/item-store.ts: `storePathOverridden`
 *     forces `cloud = null` unconditionally) — two independent reasons the
 *     network is never touched, not one.
 */
async function runCli(args: string[], extraEnv: Record<string, string>, home: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'HOME' || key === 'USERPROFILE' || key.includes('KNOWLEDGE') || value === undefined) continue;
    env[key] = value;
  }
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: { ...env, HOME: home, USERPROFILE: home, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe('ItemStore (local transport) — the lost-update defect and its CAS fix', () => {
  test('repro: two stale reads, two honest writes — the SECOND is rejected, not silently accepted', async () => {
    const dir = freshDir('ok-cas-repro-');
    const store = localStore(dir);
    const created = await store.create({ description: TEST_DESCRIPTION, title: 'Shared entry', content: 'BASE-CONTENT-LINE-ORIGINAL' });
    expect(created.version).toBe(1);

    // Both agents read the SAME version, independently.
    const readByA = await store.get(created.id);
    const readByB = await store.get(created.id);
    expect(readByA!.version).toBe(1);
    expect(readByB!.version).toBe(1);

    // Agent A writes, honestly declaring the version it read.
    const afterA = await store.update(
      created.id,
      { content: `${readByA!.content}\nAAA` },
      { expectedVersion: readByA!.version },
    );
    expect(afterA!.version).toBe(2);
    expect(afterA!.content).toBe('BASE-CONTENT-LINE-ORIGINAL\nAAA');

    // Agent B, from its OWN (now stale) read, tries the same edit. This
    // MUST be rejected. Before the fix, LocalItemStore.update ignored
    // `expectedVersion` entirely (it did not even accept the parameter), so
    // this call would succeed at rc=0 and silently destroy A's line — the
    // exact defect this task exists to fix.
    let caught: unknown = null;
    try {
      await store.update(
        created.id,
        { content: `${readByB!.content}\nBBB` },
        { expectedVersion: readByB!.version },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeVersionConflictError);
    expect((caught as KnowledgeVersionConflictError).expected).toBe(1);
    expect((caught as KnowledgeVersionConflictError).current).toBe(2);

    // A's write survives, untouched. Against the pre-fix store this
    // assertion fails: final content there is
    // "BASE-CONTENT-LINE-ORIGINAL\nBBB" (A's line gone) at version 3 — a
    // clean rc=0 that silently clobbered the intervening write.
    const final = await store.get(created.id);
    expect(final!.content).toBe('BASE-CONTENT-LINE-ORIGINAL\nAAA');
    expect(final!.version).toBe(2);
  });

  test('a fresh expectedVersion is accepted — positive control, so the guard is not simply always-on', async () => {
    const dir = freshDir('ok-cas-positive-');
    const store = localStore(dir);
    const created = await store.create({ description: TEST_DESCRIPTION, title: 'Uncontended', content: 'a' });
    const updated = await store.update(created.id, { content: 'b' }, { expectedVersion: created.version });
    expect(updated!.version).toBe(2);
    expect(updated!.content).toBe('b');
  });

  test('omitting expectedVersion keeps the pre-existing unconditional-overwrite behaviour (backward compatible)', async () => {
    const dir = freshDir('ok-cas-unconditional-');
    const store = localStore(dir);
    const created = await store.create({ description: TEST_DESCRIPTION, title: 'No guard', content: 'a' });
    await store.update(created.id, { content: 'b' }); // no expectedVersion at all — must not throw
    const after = await store.update(created.id, { content: 'c' }); // still none
    expect(after!.content).toBe('c');
    expect(after!.version).toBe(3);
  });

  test('a pre-existing item with no version field yet is read as version 1, not silently unguardable', async () => {
    const dir = freshDir('ok-cas-legacy-');
    const path = join(dir, 'db.json');
    writeFileSync(path, JSON.stringify({
      items: [{
        id: 'k_legacy', short_id: 'legacy', title: 'T', content: 'c', url: null, tags: [],
        created_at: 'x', updated_at: 'x',
        // deliberately NO `version` field — the exact shape of an item
        // written before this counter existed.
      }],
    }));
    const store = resolveItemStore({ storePath: path, storePathOverridden: true });
    let caught: unknown = null;
    try {
      await store.update('k_legacy', { content: 'clobbered' }, { expectedVersion: 99 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeVersionConflictError);
    expect((caught as KnowledgeVersionConflictError).expected).toBe(99);
    expect((caught as KnowledgeVersionConflictError).current).toBe(1);
    expect((await store.get('k_legacy'))!.content).toBe('c');
  });
});

describe('knowledge update --if-version — CLI end to end against a real local store', () => {
  test('a stale --if-version is rejected: distinct exit 2, names both versions, content is NOT clobbered', async () => {
    const home = freshDir('ok-cas-cli-home-');
    const storePath = join(freshDir('ok-cas-cli-store-'), 'db.json');

    const created = await runCli(['add', '--description', CLI_TEST_DESCRIPTION, 'Shared', 'BASE-CONTENT-LINE-ORIGINAL', '--store', storePath, '--json'], {}, home);
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { item: { id: string } }).item.id;

    // Both agents "read" separately, at version 1. The get calls are kept
    // deliberately separate from the writes below — that separation IS the
    // repro: the version a caller acts on can be older than the version a
    // freshly re-fetched internal read would show.
    const readA = await runCli(['get', '--id', id, '--store', storePath, '--json'], {}, home);
    const readB = await runCli(['get', '--id', id, '--store', storePath, '--json'], {}, home);
    expect((JSON.parse(readA.stdout) as { item: { version: number } }).item.version).toBe(1);
    expect((JSON.parse(readB.stdout) as { item: { version: number } }).item.version).toBe(1);

    const writeA = await runCli(
      ['update', '--id', id, '--content', 'BASE-CONTENT-LINE-ORIGINAL\nAAA', '--if-version', '1', '--store', storePath, '--json'],
      {},
      home,
    );
    expect(writeA.exitCode).toBe(0);

    const writeB = await runCli(
      ['update', '--id', id, '--content', 'BASE-CONTENT-LINE-ORIGINAL\nBBB', '--if-version', '1', '--store', storePath, '--json'],
      {},
      home,
    );
    // The defect this fixes: before the guard existed, this exited 0 and
    // silently clobbered A's write.
    expect(writeB.exitCode).toBe(2);
    expect(writeB.stderr).toContain('version_conflict');
    expect(writeB.stderr).toContain('version 1');
    expect(writeB.stderr).toContain('now at version 2');
    const errJson = JSON.parse(writeB.stdout) as { ok: boolean; code: string; expected: number; current: number };
    expect(errJson.ok).toBe(false);
    expect(errJson.code).toBe('version_conflict');
    expect(errJson.expected).toBe(1);
    expect(errJson.current).toBe(2);

    const final = await runCli(['get', '--id', id, '--store', storePath, '--json'], {}, home);
    const finalItem = (JSON.parse(final.stdout) as { item: { content: string; version: number } }).item;
    expect(finalItem.content).toBe('BASE-CONTENT-LINE-ORIGINAL\nAAA');
    expect(finalItem.version).toBe(2);
  });

  test('a current --if-version is accepted (positive control over the CLI path)', async () => {
    const home = freshDir('ok-cas-cli-home2-');
    const storePath = join(freshDir('ok-cas-cli-store2-'), 'db.json');
    const created = await runCli(['add', '--description', CLI_TEST_DESCRIPTION, 'T', 'a', '--store', storePath, '--json'], {}, home);
    const id = (JSON.parse(created.stdout) as { item: { id: string } }).item.id;
    const result = await runCli(['update', '--id', id, '--content', 'b', '--if-version', '1', '--store', storePath, '--json'], {}, home);
    expect(result.exitCode).toBe(0);
    const item = (JSON.parse(result.stdout) as { item: { content: string; version: number } }).item;
    expect(item.content).toBe('b');
    expect(item.version).toBe(2);
  });

  test('--if-version rejects a non-integer value before touching the store (generic exit 1, not the conflict exit 2)', async () => {
    const home = freshDir('ok-cas-cli-home3-');
    const storePath = join(freshDir('ok-cas-cli-store3-'), 'db.json');
    const created = await runCli(['add', '--description', CLI_TEST_DESCRIPTION, 'T', 'a', '--store', storePath, '--json'], {}, home);
    const id = (JSON.parse(created.stdout) as { item: { id: string } }).item.id;
    const result = await runCli(['update', '--id', id, '--content', 'b', '--if-version', 'nope', '--store', storePath, '--json'], {}, home);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--if-version');
    // The assertion above is NOT sufficient by itself: on a build where
    // --if-version does not exist at all, argument parsing rejects it as an
    // unrecognized flag, echoes the flag's own name back in the message
    // ("Unknown flag: --if-version. Run 'knowledge --help' for valid
    // options."), and ALSO exits 1 — so `toContain('--if-version')` passes
    // for the wrong reason on that build too. This second assertion is what
    // actually distinguishes "the flag exists and rejected a bad value" from
    // "the flag does not exist"; drop it and this test cannot tell the two
    // apart (measured: it stays green with --if-version support fully
    // reverted).
    expect(result.stderr).not.toContain('Unknown flag');
    // Confirms nothing was written under the bad flag.
    const after = await runCli(['get', '--id', id, '--store', storePath, '--json'], {}, home);
    expect((JSON.parse(after.stdout) as { item: { content: string } }).item.content).toBe('a');
  });

  test('omitting --if-version keeps the CLI working exactly as before (backward compatible)', async () => {
    const home = freshDir('ok-cas-cli-home4-');
    const storePath = join(freshDir('ok-cas-cli-store4-'), 'db.json');
    const created = await runCli(['add', '--description', CLI_TEST_DESCRIPTION, 'T', 'a', '--store', storePath, '--json'], {}, home);
    const id = (JSON.parse(created.stdout) as { item: { id: string } }).item.id;
    const result = await runCli(['update', '--id', id, '--content', 'b', '--store', storePath, '--json'], {}, home);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as { item: { content: string } }).item.content).toBe('b');
  });
});

describe('isolation: --store plus a poisoned cloud environment never reaches the network or the real store', () => {
  test('an explicit --store wins even under a fully-selected postgres mode pointed at a guard-refused host, and the default local store stays untouched', async () => {
    const home = freshDir('ok-cas-isolation-home-');
    const storePath = join(freshDir('ok-cas-isolation-store-'), 'db.json');

    // Simulate the exact ambient-shell hazard the fleet rule warns about: a
    // fully-selected cloud mode (not just a pointer var) aimed at a
    // non-loopback host, which @hasna/knowledge's own net-guard refuses
    // outright under NODE_ENV=test (set automatically by `bun test`, and
    // carried into the child by runCli's env copy) — this is deliberately
    // NOT loopback, so it cannot be mistaken for the hermetic
    // Bun.serve-on-127.0.0.1 pattern this repo's other tests use.
    const poisonedEnv = {
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
      HASNA_KNOWLEDGE_API_URL: 'https://example.invalid',
      HASNA_KNOWLEDGE_API_KEY: 'not-a-real-key',
    };

    const created = await runCli(['add', '--description', CLI_TEST_DESCRIPTION, 'Isolated', 'v1', '--store', storePath, '--json'], poisonedEnv, home);
    expect(created.exitCode).toBe(0);
    const id = (JSON.parse(created.stdout) as { item: { id: string } }).item.id;

    const updated = await runCli(
      ['update', '--id', id, '--content', 'v2', '--if-version', '1', '--store', storePath, '--json'],
      poisonedEnv,
      home,
    );
    expect(updated.exitCode).toBe(0);

    // Isolation assertion 1: the TEMP location gained the row.
    const raw = JSON.parse(readFileSync(storePath, 'utf8')) as {
      items: { id: string; content: string; version: number }[];
    };
    const stored = raw.items.find((item) => item.id === id);
    expect(stored?.content).toBe('v2');
    expect(stored?.version).toBe(2);

    // Isolation assertion 2: the REAL (default) local store location,
    // resolved under this test's isolated HOME, was never created — every
    // write in this test went ONLY to the explicit --store path, never to
    // the machine/user default the CLI would otherwise fall back to. If the
    // CLI had silently ignored --store (or resolved the cloud transport and
    // then fallen back to a default local write), this file would exist.
    const defaultStoreUnderFakeHome = join(home, '.hasna', 'knowledge', 'db.json');
    expect(existsSync(defaultStoreUnderFakeHome)).toBe(false);
  });
});
