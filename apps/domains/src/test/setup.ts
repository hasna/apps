import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep unit tests on local SQLite even when the shell has domains hosted
// credentials exported for normal CLI use. The scrub covers every name the
// shared resolver can read for THIS app (authority, key, deliberate pointers,
// the global profile) plus the shared-root overrides that would redirect its
// disk tier: a suite process must never resolve a hosted credential by
// accident (hasna/apps#1720, class B).
const DOMAINS_TEST_SCRUB = [
  "HASNA_DOMAINS_API_URL",
  "HASNA_DOMAINS_API_KEY",
  "DOMAINS_API_URL",
  "DOMAINS_API_KEY",
  "HASNA_DOMAINS_API_KEY_OVERRIDE",
  "HASNA_DOMAINS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_HOME",
  "HASNA_CONFIG_HOME",
] as const;

for (const key of DOMAINS_TEST_SCRUB) {
  delete process.env[key];
}

delete process.env["DOMAINS_DB_PATH"];
delete process.env["HASNA_DOMAINS_DB_PATH"];
delete process.env["HASNA_DOMAINS_DIR"];
delete process.env["HASNA_DOMAINS_HOME"];

// The suite's explicit local-store opt-in: a mkdtemp directory. With the scrub
// above in place this is the ONLY store the suite can resolve.
const domainsTestDir = mkdtempSync(join(tmpdir(), "open-domains-test-"));
process.env["DOMAINS_DIR"] = domainsTestDir;

process.on("exit", () => {
  rmSync(domainsTestDir, { recursive: true, force: true });
});