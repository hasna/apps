import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPrepublishTestEnv } from "../../../scripts/prepublish-local-test.mjs";
import type { V1Stub } from "../../test-support/v1-stub.js";
export const providerId = "00000000-0000-4000-8000-000000000079";
export const sourceId = "00000000-0000-4000-8000-000000000080";
export const domainName = "example.test";
export const setupReceipt = { ok: true, verified: true, domain: domainName, source_id: sourceId, bucket: "bound-inbound", prefix: "inbound/example.test/", region: "us-east-1", changed: ["receipt_rule_created"], attempted: ["receipt_rule_created"], changes_may_have_applied: false, worker_started: false, delivery_tested: false };
export const baseSeed = () => ({
  providers: [{ id: providerId, name: "fixture-ses", type: "ses", active: true }],
  sources: [{ id: sourceId, provider_id: providerId, type: "ses_s3", status: "active", settings_json: { bucket: "bound-inbound", prefix: "inbound/example.test/", region: "us-east-1", source_status: "live", live_sync_enabled: true } }],
  "ses-setup-results": [{ domain: domainName, receipt: setupReceipt }],
  "domain-connect-enabled": [{ id: "enabled" }],
});
export function cliFixture(api: V1Stub) {
  const home = mkdtempSync(join(tmpdir(), "emails-domain-setup-")); chmodSync(home, 0o700);
  mkdirSync(join(home, "tmp"), { mode: 0o700 });
  const env = { ...buildPrepublishTestEnv(process.env, home), HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: `domain-setup-${crypto.randomUUID()}`, EMAILS_CLIENT_ENV_LOADED: "1", NO_COLOR: "1" };
  delete env.HASNA_EMAILS_API_URL; delete env.HASNA_EMAILS_API_KEY;
  const directory = join(home, ".hasna", "emails", "config"); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const credentials = join(directory, "credentials");
  writeFileSync(credentials, `HASNA_EMAILS_API_URL=${api.baseUrl}\nHASNA_EMAILS_API_KEY=${api.apiKey}\n`, { mode: 0o600 });
  const original = readFileSync(credentials, "utf8");
  return {
    run(args: string[]) {
      const child = Bun.spawnSync({ cmd: [process.execPath, "src/cli/index.tsx", "--json", ...args], env, cwd: fileURLToPath(new URL("../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
      const stdout = child.stdout.toString(), stderr = child.stderr.toString();
      return { code: child.exitCode, stdout, stderr, data: stdout.trim() ? JSON.parse(stdout) : null };
    },
    unchanged() { return readFileSync(credentials, "utf8") === original && !readdirSync(home, { recursive: true }).some(file => /(?:\.db|\.sqlite|config\.json|config\.toml)$/.test(String(file))); },
    close() { rmSync(home, { recursive: true, force: true }); },
  };
}
