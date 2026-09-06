/**
 * Test env isolation — loaded via `[test] preload` in bunfig.toml.
 *
 * The calendar test suite exercises the LOCAL SQLite store and a locally bound
 * server. Any developer or fleet station that has the client env exported (a
 * station with `HASNA_CALENDAR_API_URL` + `HASNA_CALENDAR_API_KEY` is the
 * normal state) would otherwise have `getStore()` resolve to the ApiStore and
 * every "local" test would silently read and write the LIVE deployment — which
 * is exactly why 11 tests failed on a clean checkout before this hotfix.
 *
 * SINCE THE 2026-09-04 RESOLVER ADOPTION (hasna/apps#1720) a credential can
 * ALSO arrive from the macOS Keychain or `~/.hasna/calendar/config/credentials`
 * — neither of which an env dictionary can blank. Two pins make those ambient
 * tiers reliably EMPTY for every test process:
 *
 *   - `HASNA_STATION` chooses the Keychain ACCOUNT the tier looks under
 *     (else the machine's short hostname, then `USER`), so pinning it to a
 *     name no item uses makes tier 3 answer item-not-found — an absent tier —
 *     on a developer Mac and CI alike.
 *   - `HASNA_HOME` replaces the `~/.hasna` root the DISK tier reads, and is
 *     pointed at a scratch path that exists nowhere, so tier 4 finds no
 *     credentials file no matter what the developer's real home holds.
 *
 * Scrubbing here (and not per-test) also means the CLI tests, which spawn
 * `bun run src/cli/index.tsx` with `{ ...process.env }`, inherit a clean env.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

const ISOLATED_ENV_VARS = [
  // client env (store/http-storage.ts — @hasna/contracts chain)
  "HASNA_CALENDAR_API_URL",
  "CALENDAR_API_URL",
  "HASNA_CALENDAR_API_KEY",
  "CALENDAR_API_KEY",
  // deliberate pointers and profile selection (the resolver's tier 2)
  "HASNA_CALENDAR_API_KEY_OVERRIDE",
  "HASNA_CALENDAR_API_KEY_REF",
  "HASNA_PROFILE",
  // retired placement selectors — fail-loud ratchet inputs, never ambient
  "HASNA_CALENDAR_MODE",
  "CALENDAR_MODE",
  "HASNA_CALENDAR_STORAGE_MODE",
  "CALENDAR_STORAGE_MODE",
  "HASNA_CALENDAR_BACKEND",
  "CALENDAR_BACKEND",
  "HASNA_CALENDAR_LOCAL",
  "CALENDAR_LOCAL",
  "HASNA_CALENDAR_SELF_HOSTED",
  "CALENDAR_SELF_HOSTED",
  "HASNA_CALENDAR_CLOUD",
  "CALENDAR_CLOUD",
  // hosted /v1 wiring (server/cloud.ts)
  "HASNA_CALENDAR_DATABASE_URL",
  "CALENDAR_DATABASE_URL",
  "DATABASE_URL",
  "HASNA_CALENDAR_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
  // local-plane auth posture (server/auth-posture.ts)
  "CALENDAR_SERVE_API_KEY",
  "HASNA_CALENDAR_SERVE_API_KEY",
  "CALENDAR_ALLOW_ANONYMOUS",
] as const;

for (const key of ISOLATED_ENV_VARS) {
  delete process.env[key];
}

/**
 * Pinned values that keep the @hasna/contracts AMBIENT tiers empty: the
 * Keychain account no item can exist under, and a hasna home that exists
 * nowhere. Pinned, never blanked: blanking `HASNA_STATION` would let the
 * account fall back to the machine's own short hostname, which is exactly the
 * item a test must not reach.
 */
export const TEST_KEYCHAIN_ACCOUNT = "calendar-test-fixture-no-such-station";
export const TEST_HASNA_HOME = join(tmpdir(), "calendar-test-hasna-home-nonexistent");

process.env.HASNA_STATION = TEST_KEYCHAIN_ACCOUNT;
process.env.HASNA_HOME = TEST_HASNA_HOME;

export { ISOLATED_ENV_VARS };