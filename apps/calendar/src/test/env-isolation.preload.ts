/**
 * Test env isolation — loaded via `[test] preload` in bunfig.toml.
 *
 * The calendar test suite exercises the LOCAL SQLite store and a locally bound
 * server. Any developer or fleet station that has the client-flip env exported
 * (a station with `HASNA_CALENDAR_STORAGE_MODE=cloud` +
 * `HASNA_CALENDAR_API_URL` + `HASNA_CALENDAR_API_KEY` is the normal state) would
 * otherwise have `getStore()` resolve to the ApiStore and every "local" test
 * would silently read and write the LIVE deployment — which is exactly why 11
 * tests failed on a clean checkout before this hotfix.
 *
 * Scrubbing here (and not per-test) also means the CLI tests, which spawn
 * `bun run src/cli/index.tsx` with `{ ...process.env }`, inherit a clean env.
 */

const ISOLATED_ENV_VARS = [
  // client flip (store/http-storage.ts)
  "HASNA_CALENDAR_STORAGE_MODE",
  "HASNA_CALENDAR_MODE",
  "CALENDAR_STORAGE_MODE",
  "CALENDAR_MODE",
  "HASNA_CALENDAR_API_URL",
  "CALENDAR_API_URL",
  "HASNA_CALENDAR_API_KEY",
  "CALENDAR_API_KEY",
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

export { ISOLATED_ENV_VARS };
