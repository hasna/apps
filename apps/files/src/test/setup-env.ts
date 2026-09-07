// Test-suite environment preload (bunfig.toml [test] preload).
//
// The suite runs against the on-box SQLite transport by default, exactly as it
// did before the fail-closed conversion — but through the documented explicit
// opt-in (HASNA_FILES_LOCAL=1) rather than as the no-env default. A developer
// shell must never leak hosted credentials into a test process, and a test must
// never accidentally exercise the new fail-closed path: individual fail-closed
// tests construct their own env objects (or spawn subprocesses) with the
// authority keys AND the opt-in removed.
const CLIENT_HOSTED_ENV_KEYS = [
  "HASNA_FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "FILES_API_URL",
  "FILES_API_KEY",
] as const;

for (const key of CLIENT_HOSTED_ENV_KEYS) {
  delete process.env[key];
}

// The explicit local opt-in (HASNA_FILES_LOCAL, alias FILES_LOCAL). The
// retired HASNA_FILES_LOCAL_MODE / FILES_LOCAL_MODE spells are gone.
process.env.HASNA_FILES_LOCAL = "1";