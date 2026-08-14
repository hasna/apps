import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep unit tests on local SQLite even when the shell has domains cloud client
// credentials exported for normal CLI use.
const DOMAINS_CLOUD_ENV = [
  "HASNA_DOMAINS_API_URL",
  "HASNA_DOMAINS_API_KEY",
  "HASNA_DOMAINS_MODE",
  "DOMAINS_API_URL",
  "DOMAINS_API_KEY",
] as const;

for (const key of DOMAINS_CLOUD_ENV) {
  delete process.env[key];
}

delete process.env["DOMAINS_DB_PATH"];
delete process.env["HASNA_DOMAINS_DB_PATH"];
delete process.env["HASNA_DOMAINS_DIR"];

const domainsTestDir = mkdtempSync(join(tmpdir(), "open-domains-test-"));
process.env["DOMAINS_DIR"] = domainsTestDir;
process.env["HASNA_DOMAINS_STORAGE_MODE"] = "local";
process.env["DOMAINS_STORAGE_MODE"] = "local";

process.on("exit", () => {
  rmSync(domainsTestDir, { recursive: true, force: true });
});
