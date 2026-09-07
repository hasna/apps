// ============================================================================
// `bun test` preload — no test process may reach the shared cloud store.
//
// Wired up in bunfig.toml (`[test] preload`), so this runs once per test process
// BEFORE any test module is imported.
//
// Per-harness isolation (src/test-support/store-isolation.ts) fixes the harnesses
// that remember to use it. This closes the class, for two reasons the harness fix
// cannot reach on its own:
//
//   1. IN-PROCESS writes. The domain layer routes by mode, not by harness:
//      `src/db/memories.ts:113` is `if (!db && isApiMode())` → HTTP. So any test
//      that calls `createMemory(...)` without an explicit `db` handle writes to
//      the shared cloud store, with no subprocess and no env spread involved.
//      Roughly every domain test is shaped that way.
//   2. INHERITED envs. Children spawned with `{ ...process.env }` inherit what
//      this file has already cleaned, so even a harness that never adopts the
//      helper is safe under `bun test`.
//
// It deletes the selectors rather than setting a mode, because presence is what
// selects the transport (see src/db/api-mode.ts). It deliberately does NOT pin a
// database path: several suites assert the resolved default path
// (src/db/database.test.ts, src/lib/config-extra.test.ts), and overriding it here
// would break them. Suites that must not touch the on-disk local store still set
// `MEMENTOS_DB_PATH` themselves — anything set after this file runs still wins,
// which is also what lets the deliberate API-mode suites
// (src/db/api-mode.test.ts, src/cli/clean-legacy-fallback.test.ts) configure a
// stub endpoint normally.
//
// SINCE 2026-09-04 (hasna/apps#1720) the transport resolves through the
// @hasna/contracts client chain, whose Keychain and credentials-file tiers are
// AMBIENT: an env dictionary cannot blank the macOS login keychain, and the disk
// tier reads `~/.hasna/mementos/config/credentials` under the machine's real
// HOME. This file therefore applies three neutralizers that together make the
// chain physically unreachable, exactly like the deliberate local opt-in does
// for the CLI:
//
//   - the EXPLICIT LOCAL OPT-IN (`HASNA_MEMENTOS_LOCAL=1` / `MEMENTOS_LOCAL=1`),
//     which selects the on-box store BEFORE the resolver runs — no Keychain item
//     and no credential file is ever read; and
//   - `HASNA_STATION` pinned to an account name no item can exist under, so even
//     a deliberate hosted-arm test cannot bump into the operator's REAL Keychain
//     item; and
//   - `HASNA_CONFIG_HOME` pinned to a fresh scratch directory, so the disk tier
//     reads a credentials file that cannot exist (an empty directory), never the
//     operator's real `~/.hasna/mementos/config/credentials`.
//
// The guard at the bottom then asks the resolver DIRECTLY whether any credential
// survives the scrub — a tier that leaks (a Keychain item under another account
// name the resolver could still reach via `hostname -s`, a credentials file the
// config-home pin does not cover) THROWS and takes the whole test process down.
// A red run is the correct outcome: the alternative is a green run that quietly
// wrote test fixtures into the memory layer other agents read.
// ============================================================================

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCredential } from "@hasna/contracts/client";
import {
  LOCAL_ONLY_STORE_ENV_KEYS,
  MEMENTOS_TEST_KEYCHAIN_ACCOUNT,
  REMOVED_STORE_ENV_KEYS,
  STORE_SELECTOR_ENV_KEYS,
} from "./store-isolation.js";

// The fresh scratch root that stands in for `HASNA_CONFIG_HOME` (the tier the
// credential chain reads its config/credentials file from). Removed on the way
// out so repeated runs do not litter the system temp.
const neutralizerRoot = mkdtempSync(join(tmpdir(), "mementos-test-config-home-"));

const removed: string[] = [];
for (const key of [...STORE_SELECTOR_ENV_KEYS, ...REMOVED_STORE_ENV_KEYS]) {
  if (process.env[key] !== undefined) {
    removed.push(key);
    delete process.env[key];
  }
}

const localDefaults: Record<string, string> = {
  HASNA_MEMENTOS_LOCAL: "1",
  MEMENTOS_LOCAL: "1",
  HASNA_STATION: MEMENTOS_TEST_KEYCHAIN_ACCOUNT,
  HASNA_CONFIG_HOME: neutralizerRoot,
};

// The opt-in is a property of the local intent env; the neutralizers must be
// assignable even when a suite deliberately exercises the hosted arm, so they
// are applied LAST and are overridable by nothing here.
for (const key of LOCAL_ONLY_STORE_ENV_KEYS) {
  if (process.env[key] !== undefined) {
    removed.push(key);
    delete process.env[key];
  }
}
for (const [key, value] of Object.entries(localDefaults)) {
  process.env[key] = value;
}

// Ask the resolver directly whether ANY credential survives the scrub. The
// local opt-in above is answered before the resolver, so this pass exists to
// prove the neutralizers hold for the suites that DO go hosted — a Keychain
// item or credentials file leaking through would resolve here.
{
  const leaked = resolveCredential("mementos", process.env as Record<string, string | undefined>);
  if (leaked) {
    throw new Error(
      "test preload: REFUSING TO RUN THE TEST SUITE — a mementos credential still resolves " +
        "after clearing every known store selector and neutralizing the ambient tiers, so writes " +
        "would land in the SHARED PRODUCTION memory store.\n" +
        `  credential from : ${leaked.source} (tier ${leaked.tier})\n` +
        `  cleared         : ${removed.join(", ") || "(nothing)"}\n` +
        "A new store selector or ambient tier exists that this preload does not cover. Export it from " +
        "the resolver that reads it and add it to src/test-support/store-isolation.ts.",
    );
  }
}

// Opt-in trace. Silent by default: with `bun test --isolate` this file runs once
// per test file, so announcing unconditionally would bury the actual results.
if (process.env["MEMENTOS_TEST_VERBOSE_ISOLATION"] && removed.length > 0) {
  console.error(`[test preload] cleared store selectors: ${removed.join(", ")}`);
}

// Remove the neutralizer scratch root on the way out so a repeated `bun test`
// does not leave one directory per run behind in the system temp. Guarded so a
// failure to clean can never turn a green suite red.
process.once("exit", () => {
  try {
    rmSync(neutralizerRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  } catch {
    // Best effort: a leaked temp directory is not worth failing a test run over.
  }
});