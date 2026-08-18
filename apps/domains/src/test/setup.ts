import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep unit tests on local SQLite even when the shell has domains hosted
// client credentials exported for normal CLI use.
const DOMAINS_HOSTED_ENV = [
  "HASNA_DOMAINS_API_URL",
  "HASNA_DOMAINS_API_KEY",
  "DOMAINS_API_URL",
  "DOMAINS_API_KEY",
] as const;

for (const key of DOMAINS_HOSTED_ENV) {
  delete process.env[key];
}

delete process.env["DOMAINS_DB_PATH"];
delete process.env["HASNA_DOMAINS_DB_PATH"];
delete process.env["HASNA_DOMAINS_DIR"];

const domainsTestDir = mkdtempSync(join(tmpdir(), "open-domains-test-"));
process.env["DOMAINS_DIR"] = domainsTestDir;

process.on("exit", () => {
  rmSync(domainsTestDir, { recursive: true, force: true });
});
