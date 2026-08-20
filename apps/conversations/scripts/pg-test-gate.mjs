#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Proves the server's OWN PostgreSQL code path against a real server: the
 * incident-projection verifier (src/server/incident-projection-pg.verify.ts)
 * provisions a disposable schema under the provided DSN, applies the repo's
 * migration set, and runs the public HTTP scenarios end to end.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 2 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent.
 *
 *   CONVERSATIONS_TEST_DATABASE_URL=postgres://... bun run test:pg
 *
 * The DSN variable is TEST-ONLY and deliberately distinct from
 * HASNA_CONVERSATIONS_DATABASE_URL, so pointing the gate at a live store takes
 * a separate, explicit act. The connection string is never printed, in full or
 * in part; only the env key name appears in messages.
 */
import { join } from "node:path";

const ENV_VAR = "CONVERSATIONS_TEST_DATABASE_URL";
// Test-only signing secret for the verifier's disposable api-key mint. Never
// the production signing key: the gate points at a throwaway test database.
const SIGNING_SECRET = "conversations-pg-test-gate-signing-secret-32b!";

const connectionString = process.env[ENV_VAR]?.trim();
if (!connectionString) {
  console.error(
    `[pg-test-gate] FAIL: ${ENV_VAR} is not set. This gate proves live PostgreSQL support and cannot ` +
      `pass without a PostgreSQL server; point it at a throwaway test database.`,
  );
  process.exit(2);
}

const repoRoot = join(import.meta.dir, "..");
const verifier = join(repoRoot, "src", "server", "incident-projection-pg.verify.ts");
const result = Bun.spawnSync(["bun", "run", verifier, "--require-live"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    HASNA_CONVERSATIONS_DATABASE_URL_OWNER: connectionString,
    HASNA_CONVERSATIONS_API_SIGNING_KEY: SIGNING_SECRET,
  },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode ?? 1);
