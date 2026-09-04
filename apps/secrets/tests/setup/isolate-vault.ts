// Run-wide test preload. Registered in bunfig.toml as `[test] preload`, so it runs
// once per test process BEFORE any test file is evaluated, whether the suite is run
// whole or one file at a time. No test has to import it, and no test can skip it.
//
// It does one job: take the hosted-vault steering wheel away from the ambient
// environment. On a Hasna fleet machine the shell profile exports
// HASNA_SECRETS_STORAGE_MODE / _API_URL / _API_KEY, which is what routed this repo's
// own fixtures into the production vault four times (HC-00304).
//
// This is the CONVENIENCE half of the fix, not the load-bearing half: with the
// selectors gone, ordinary tests resolve LocalStore and simply work. The guarantee
// lives in src/test-isolation.ts, which throws if anything reaches a non-loopback
// vault even when this preload never ran.
//
// Nothing here prints, logs, or stores a value — only variable NAMES.

import { clientTransportEnvKeys } from "../../src/store/contracts-client/transport.js";
import { LOCAL_VAULT_OPT_IN_ENV_KEY } from "../../src/store/index.js";
import { TEST_ISOLATION_ENV_KEY, testVaultDir } from "../../src/test-isolation.js";

const APP_NAME = "secrets";

// Read the selector list FROM the transport that acts on it, so a selector added to
// the client-flip contract later is scrubbed automatically instead of needing this
// file to be remembered and edited.
const keys = clientTransportEnvKeys(APP_NAME);
const selectorKeys = [...keys.modeKeys, ...keys.apiUrlKeys, ...keys.apiKeyKeys];

const removed: string[] = [];
for (const key of selectorKeys) {
  if (process.env[key] !== undefined) {
    delete process.env[key];
    removed.push(key);
  }
}

// Turns the guard ON for THIS process. There is no value that turns it off.
//
// IT DOES NOT REACH CHILD PROCESSES BY DEFAULT, and neither does the scrub above.
// Measured on bun 1.3.14: a child spawned without an explicit `env:` receives the
// process's INITIAL environment snapshot, not its current one — so it sees neither
// the marker nor the deletions, and still carries whatever hosted-vault selectors
// the machine exported. Only `NODE_ENV=test` survives, because that was in the
// snapshot, which collapses the three-signal defense to one across a process
// boundary.
//
//   default env:  FRESH=undefined MARKER=undefined  selectors: all three present
//   explicit env: FRESH=yes       MARKER=1          selectors: none
//
// THEREFORE: any test that spawns the CLI MUST pass `env: { ...process.env, ... }`
// explicitly. Every spawn in tests/ does; tests/test-isolation.ts pins that a
// default-env child is not covered, so this cannot quietly drift back.
process.env[TEST_ISOLATION_ENV_KEY] = "1";

// The whole suite EXPLICITLY opts into the local vault (owner ruling
// 2026-09-04): store resolution without the hosted API env pair now FAILS
// CLOSED unless HASNA_SECRETS_LOCAL_VAULT=1 is present, and the local-store
// tests need that opt-in. Setting it here, once per test process, covers
// in-process `getStore()` calls and — through the explicit
// `env: { ...process.env }` spreads every spawn uses — spawned CLI children.
// A test that asserts the fail-closed DEFAULT deletes this key alongside the
// hosted-vault selectors (see tests/cli-fail-closed.test.ts).
process.env[LOCAL_VAULT_OPT_IN_ENV_KEY] = "1";

// One line per run, on the runner's own stream (never a spawned CLI child's), so the
// isolation is observable rather than assumed. Names and paths only — no values. It
// also names the throwaway vault any test that configures nothing will land in.
console.error(
  `[secrets] test isolation: vault confined to ${testVaultDir()}; ` +
    `local vault opted in via ${LOCAL_VAULT_OPT_IN_ENV_KEY}=1; ` +
    (removed.length > 0
      ? `removed ${removed.length} hosted-vault selector(s) from the environment: ${removed.join(", ")}`
      : "no hosted-vault selectors were present in the environment"),
);
