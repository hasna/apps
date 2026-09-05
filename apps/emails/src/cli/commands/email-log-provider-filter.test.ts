// The real CLI must refuse provider filtering, not return unscoped mail or an
// invented empty ledger. The explicit in-memory store is a TEST backing for the
// authenticated loopback API, never client configuration or provider execution.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { closeDatabase, getDatabase, type Database } from "../../db/database.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV,
  EMAILS_API_URL_SETTINGS, RETIRED_EMAILS_SELECTOR_SETTINGS } from "../../lib/client-settings.js";
import { CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, EMAILS_CLIENT_ENV_SECRET_ENV } from "../../lib/client-env.js";
import { createSentEmailLedger, storeSentEmailContent } from "../../lib/sent-ledger.local.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import type { EmailStore } from "../../store/email-store.js";
import type { ListMessagesOptions } from "../../store/records.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";

const APP_ROOT = resolve(import.meta.dir, "../../..");
const WRONG_KEY = "fixture-ledger-wrong-key";
let originalEnv: NodeJS.ProcessEnv;
let root: string;
let stateEnv: NodeJS.ProcessEnv;
let db: Database;
let store: EmailStore;
let api: V1StoreApi;
let messageReads: ListMessagesOptions[];
let providerGets: string[];
let providerCreates: number;
let providerLists: number;
let omitProviderTenant: boolean;

// PG resources.ts + OpenAPI publish these nonsecret fields, including tenant_id;
// SQLite has no tenant column. Project ONLY this synthetic fixture response,
// retaining the actual CLI-created ID. This is not PG tenant-isolation evidence.
function providerWireRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id, ...(omitProviderTenant ? {} : { tenant_id: "00000000-0000-4000-8000-000000000001" }),
    name: row.name, type: row.type, region: row.region ?? null, active: Boolean(row.active),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

beforeEach(() => {
  originalEnv = { ...process.env };
  root = mkdtempSync(join(tmpdir(), "emails-ledger-provider-"));
  stateEnv = {};
  for (const [key, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    stateEnv[key] = path;
    process.env[key] = path;
  }
  for (const name of ["tmp", "transpiler"]) mkdirSync(join(root, name), { mode: 0o700 });
  for (const key of [...CLIENT_DATABASE_SETTINGS, ...RETIRED_EMAILS_SELECTOR_SETTINGS,
    ...EMAILS_API_URL_SETTINGS, ...CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, EMAILS_CLIENT_ENV_SECRET_ENV,
    "EMAILS_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME"]) delete process.env[key];
  closeDatabase();
  db = getDatabase(":memory:");
  store = createSqliteEmailStore({ database: db });
  messageReads = [];
  providerGets = [];
  providerCreates = 0;
  providerLists = 0;
  omitProviderTenant = false;
  api = startV1StoreApi({ store: { ...store,
    providers: { ...store.providers,
      async create(input) {
        providerCreates++;
        const result = await store.providers.create(input);
        return result.ok ? { ...result, value: providerWireRow(result.value) } : result;
      },
      async get(id) {
        providerGets.push(id);
        const result = await store.providers.get(id);
        return result.ok && result.value !== null ? { ...result, value: providerWireRow(result.value) } : result;
      },
      async list(options) {
        providerLists++;
        const result = await store.providers.list(options);
        return result.ok ? { ...result, value: result.value.map(providerWireRow) } : result;
      },
    },
    messages: { ...store.messages, async listMessages(options) {
      messageReads.push(options ?? {});
      return store.messages.listMessages(options);
    } },
  } });
  process.env[EMAILS_API_URL_ENV] = api.baseUrl;
  process.env[EMAILS_API_KEY_ENV] = api.apiKey;
  resetSelfHostedConfigCache();
  resetMailDataSource();
});

afterEach(() => {
  try {
    // Tool scratch is separate: only the six CLIENT state roots must be empty.
    for (const path of Object.values(stateEnv)) expect(readdirSync(path!)).toEqual([]);
  } finally {
    api?.stop();
    closeDatabase();
    resetSelfHostedConfigCache();
    resetMailDataSource();
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    rmSync(root, { recursive: true, force: true });
  }
});

// Allowlist, not a growing blacklist of ambient provider/config credentials.
function clientEnv(credential = api.apiKey): NodeJS.ProcessEnv {
  return {
    ...stateEnv,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: join(root, "tmp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "transpiler"),
    [EMAILS_API_URL_ENV]: api.baseUrl, [EMAILS_API_KEY_ENV]: credential,
    AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1", TZ: "UTC",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  };
}

interface CliRun { exitCode: number; stdout: string; stderr: string }

async function runCli(args: string[], env = clientEnv()): Promise<CliRun> {
  // Async parent serves HTTP while the real child synchronously invokes curl.
  const child = Bun.spawn({ cmd: [process.execPath, join(APP_ROOT, "src/cli/index.tsx"), ...args],
    cwd: APP_ROOT, env, stdout: "pipe", stderr: "pipe" });
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    for (const output of [stdout, stderr]) {
      expect(output).not.toContain(api.apiKey);
      expect(output).not.toContain(WRONG_KEY);
      expect(output).not.toContain("fixture-inherited");
    }
    return { exitCode, stdout, stderr };
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

async function seedProvider(): Promise<string> {
  const created = await runCli(["--json", "provider", "add", "--name", "ledger-filter", "--type", "sandbox"]);
  expect(created.exitCode, `provider add failed: ${created.stderr}`).toBe(0);
  expect(providerCreates).toBe(1);
  const listed = await runCli(["--json", "provider", "list"]);
  expect(listed.exitCode, `provider list failed: ${listed.stderr}`).toBe(0);
  const providers = JSON.parse(listed.stdout) as Array<{ id: string; name: string }>;
  const provider = providers.find((row) => row.name === "ledger-filter");
  expect(provider).toBeDefined();
  expect(provider!.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  expect(providerLists).toBeGreaterThan(0);
  expect((db.query("SELECT id FROM providers").all() as Array<{ id: string }>).map((row) => row.id)).toEqual([provider!.id]);
  return provider!.id;
}

async function seedLedger(providerId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const sent = await createSentEmailLedger(providerId, { from: "sender@example.test",
      to: `recipient${index}@example.test`, subject: `Ledger ${index}`,
      idempotency_key: `ledger-private-${index}` }, `provider-message-${index}`, db);
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
    db.run("UPDATE emails SET sent_at = ?, created_at = ?, updated_at = ? WHERE id = ?", [date, date, date, sent.id]);
    await storeSentEmailContent(sent.id, { text: `Stored body ${index}` }, db);
    ids.unshift(sent.id);
  }
  const inbound = await store.messages.createMessage({ from_addr: "incoming@example.test", to_addrs: ["sender@example.test"],
    subject: "Not outbound", direction: "inbound", received_at: "2026-01-03T00:00:00.000Z" });
  expect(inbound.ok).toBe(true);
  return ids;
}

describe("the sent ledger's provider filter, at the CLI", () => {
  it("refuses `email list --provider` instead of answering with every provider's mail", async () => {
    const providerId = await seedProvider();
    await seedLedger(providerId);
    const before = api.requestCount();
    const run = await runCli(["--json", "email", "list", "--provider", providerId]);
    expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
    const failure = JSON.parse(run.stderr) as { error: { message: string } };
    expect(failure.error.message).toContain("provider");
    // The canonical registration refuses the option before the store-layer field.
    expect(failure.error.message).toContain("does not support local sent-log filter(s): --provider");
    expect(run.stdout.trim()).not.toBe("[]");
    expect(run.stdout.trim()).toBe("");
    expect(api.requestCount()).toBe(before);
    expect(messageReads).toEqual([]);
  }, 120_000);

  it("refuses `export emails --provider` instead of writing every provider's mail to a file", async () => {
    const providerId = await seedProvider();
    await seedLedger(providerId);
    const outputPath = join(root, "refused.csv");
    for (const extra of [[], ["--format", "csv", "--output", outputPath]]) {
      const run = await runCli(["--json", "export", "emails", "--provider", providerId, ...extra]);
      expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
      const failure = JSON.parse(run.stderr) as { error: { message: string } };
      expect(failure.error.message).toContain("provider");
      expect(failure.error.message).toContain("no message projection on the store seam carries provider_id");
      expect(run.stdout.trim()).not.toContain("id,from,to,subject,status,sent_at");
      expect(run.stdout.trim()).toBe("");
      expect(existsSync(outputPath)).toBe(false);
    }
    expect(providerGets).toEqual([providerId, providerId]);
    expect(messageReads).toEqual([]);
  }, 120_000);

  it("still lists and exports the whole ledger when no provider is named", async () => {
    const providerId = await seedProvider();
    const empty = await runCli(["--json", "email", "list"]);
    expect(empty.exitCode, `email list failed: ${empty.stderr}`).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual([]);
    const emptyExport = await runCli(["--json", "export", "emails"]);
    expect(emptyExport.exitCode, `export failed: ${emptyExport.stderr}`).toBe(0);
    expect(JSON.parse(emptyExport.stdout)).toEqual([]);
    const ids = await seedLedger(providerId);
    for (const args of [["email", "list"], ["export", "emails"]]) {
      const before = messageReads.length;
      const run = await runCli(["--json", ...args]);
      expect(run.exitCode, run.stderr).toBe(0);
      const rows = JSON.parse(run.stdout) as Array<Record<string, unknown>>;
      expect(rows.map((row) => row.id)).toEqual(ids);
      expect(rows.map((row) => row.subject)).toEqual(["Ledger 1", "Ledger 0"]);
      expect(run.stdout).not.toContain("Not outbound");
      expect(run.stdout).not.toContain("ledger-private");
      expect(rows.every((row) => !("idempotency_key" in row))).toBe(true);
      expect(messageReads.length).toBeGreaterThan(before);
      expect(messageReads.slice(before).every((options) => options.direction === "outbound")).toBe(true);
    }
  }, 120_000);

  it("rejects a wrong credential without reading mail, resolving a provider or writing an export", async () => {
    const providerId = await seedProvider();
    await seedLedger(providerId);
    const before = api.requestCount();
    const beforeProviders = providerLists;
    const outputPath = join(root, "denied.json");
    for (const args of [["email", "list"], ["export", "emails", "--provider", providerId, "--output", outputPath]]) {
      const run = await runCli(["--json", ...args], clientEnv(WRONG_KEY));
      expect(run.exitCode).not.toBe(0);
      expect(run.stdout.trim()).toBe("");
      expect(JSON.parse(run.stderr).error.message).toMatch(/401|authentication/i);
      expect(existsSync(outputPath)).toBe(false);
    }
    expect(api.requestCount()).toBeGreaterThan(before);
    expect(providerLists).toBe(beforeProviders);
    expect(providerGets).toEqual([]);
    expect(messageReads).toEqual([]);
  }, 120_000);

  it("keeps full-ID provider lookup strict when the fixture omits the required tenant field", async () => {
    const providerId = await seedProvider();
    omitProviderTenant = true;
    const run = await runCli(["--json", "export", "emails", "--provider", providerId]);
    expect(run.exitCode).not.toBe(0);
    expect(run.stdout.trim()).toBe("");
    expect(JSON.parse(run.stderr).error.message).toContain("tenant_id");
    expect(JSON.parse(run.stderr).error.message).not.toContain("no message projection");
    expect(providerGets).toEqual([providerId]);
    expect(messageReads).toEqual([]);
  }, 120_000);

  it("does not inherit provider credentials, retired selectors or client database paths", async () => {
    const env = clientEnv();
    for (const key of [...CLIENT_DATABASE_SETTINGS, ...RETIRED_EMAILS_SELECTOR_SETTINGS,
      "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "RESEND_API_KEY",
      EMAILS_CLIENT_ENV_SECRET_ENV]) expect(env[key]).toBeUndefined();
    const run = await runCli(["--json", "email", "list"], env);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(messageReads.length).toBeGreaterThan(0);
  }, 120_000);
});
