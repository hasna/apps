// Real forwarding commands over authenticated HTTP, backed only by an explicit
// in-memory fixture. The two variants exercise documented key spellings with the
// SAME synthetic bearer, not different production principals. The original positive
// pipeline case remains a visible failure until its missing API operation exists.
// Rule CRUD passing does not establish pending-mail or delivery-ledger capability.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, type Database } from "../../db/database.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
import { listForwardingRules } from "../../db/forwarding.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import type { EmailStore } from "../../store/email-store.js";
import {
  API_BASE_URL_SETTING,
  API_CREDENTIAL_SETTINGS,
  API_SETTINGS_POINTER,
  DATABASE_PATH_SETTINGS,
} from "../../store-resolution.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";
import { EMAILS_API_KEY_ENV, EMAILS_API_KEY_SETTINGS, EMAILS_API_URL_SETTINGS,
  RETIRED_EMAILS_SELECTOR_SETTINGS } from "../../lib/client-settings.js";
import { validateSelfHostedSdkSuccessResponse } from "../../lib/self-hosted-wire.js";
import { registerForwardingCommands } from "./forwarding.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let db: Database;
let api: V1StoreApi;
let backingApi: V1StoreApi;
let root: string;
let stateRoots: string[];
let savedExit: typeof process.exit;
let savedError: typeof console.error;
let savedFetch: typeof fetch;
let resourceAccesses: string[];
let requests: Array<{ method: string; path: string; query: Record<string, string>;
  authenticated: boolean; status: number; body: unknown }>;
let outputs: Array<{ stdout: string; stderr: string; code: number }>;
let dtoFault: "missing-tenant" | "invalid-enabled" | null;
const children = new Set<Bun.Subprocess>();
const KEY_VARIANTS = [EMAILS_API_KEY_ENV, "EMAILS_SELF_HOSTED_API_KEY"] as const;
const WRONG_KEY = "fixture-forwarding-wrong-key";
const PRIVATE_TARGET = "private-forwarding-target@example.test";
// Only a wire-shape fixture, never a tenant-isolation/role-model claim.
const FIXTURE_TENANT = "11111111-1111-4111-8111-111111111111";

function clearStoreSettings(): void {
  for (const setting of [...EMAILS_API_URL_SETTINGS, API_SETTINGS_POINTER,
    ...API_CREDENTIAL_SETTINGS, ...RETIRED_EMAILS_SELECTOR_SETTINGS]) {
    delete process.env[setting];
  }
  for (const setting of DATABASE_PATH_SETTINGS) delete process.env[setting];
}

/** Canonical authenticated client; the fixture DB is never client configuration. */
function configurePrimaryStore(): void {
  clearStoreSettings();
  process.env[API_BASE_URL_SETTING] = api.baseUrl;
  process.env[EMAILS_API_KEY_ENV] = api.apiKey;
  resetSelfHostedConfigCache();
}

/**
 * The same service and bearer through its documented API-key alias.
 */
function configureApiStore(): void {
  clearStoreSettings();
  process.env[API_BASE_URL_SETTING] = api.baseUrl;
  process.env["EMAILS_SELF_HOSTED_API_KEY"] = api.apiKey;
  resetSelfHostedConfigCache();
}

function fixtureStore(): EmailStore {
  return createSqliteEmailStore({ database: db, detail: "forwarding CLI fixture" });
}

function wireRow(row: Record<string, unknown>): Record<string, unknown> {
  const enabled = row["enabled"];
  if (enabled !== 0 && enabled !== 1 && enabled !== false && enabled !== true) {
    throw new Error("invalid explicit fixture enabled value");
  }
  const projected: Record<string, unknown> = { ...row, tenant_id: FIXTURE_TENANT,
    enabled: enabled === 1 || enabled === true };
  // Require the actual service contract before any deliberate malformed-response control.
  validateSelfHostedSdkSuccessResponse("GET", "/v1/forwarding", 200, { items: [projected] });
  if (dtoFault === "missing-tenant") delete projected["tenant_id"];
  if (dtoFault === "invalid-enabled") projected["enabled"] = 2;
  return projected;
}

beforeEach(() => {
  INHERITED_PROCESS_ENV = { ...process.env };
  savedExit = process.exit;
  savedError = console.error;
  savedFetch = globalThis.fetch;
  root = mkdtempSync(join(tmpdir(), "emails-forwarding-cli-"));
  stateRoots = [];
  for (const [setting, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    stateRoots.push(path);
    process.env[setting] = path;
  }
  for (const [setting, name] of Object.entries({ TMPDIR: "tmp", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "compiler" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    process.env[setting] = path;
  }
  for (const setting of ["EMAILS_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME"]) delete process.env[setting];
  clearStoreSettings();
  closeDatabase();
  db = getDatabase(":memory:");
  requests = [];
  outputs = [];
  resourceAccesses = [];
  dtoFault = null;
  const store = fixtureStore();
  backingApi = startV1StoreApi({ store: { ...store, forwarding: { ...store.forwarding,
    async list(options) { resourceAccesses.push("list"); const r = await store.forwarding.list(options);
      return r.ok ? { ok: true, value: r.value.map(wireRow) } : r; },
    async get(id) { resourceAccesses.push(`get:${id}`); const r = await store.forwarding.get(id);
      return r.ok ? { ok: true, value: r.value === null ? null : wireRow(r.value) } : r; },
    async create(input) { resourceAccesses.push("create"); const r = await store.forwarding.create(input);
      return r.ok ? { ok: true, value: wireRow(r.value) } : r; },
    async update(id, patch) { resourceAccesses.push(`update:${id}`); const r = await store.forwarding.update(id, patch);
      return r.ok ? { ok: true, value: r.value === null ? null : wireRow(r.value) } : r; },
    remove(id) { resourceAccesses.push(`remove:${id}`); return store.forwarding.remove(id); },
  } } });
  // A real loopback forwarding observer also sees curl from the CLI child. It
  // returns the backing service's actual response; authentication remains there.
  const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const body = await request.clone().text();
    const response = await savedFetch(`${backingApi.baseUrl}${url.pathname}${url.search}`, {
      method: request.method, headers: request.headers, redirect: "error",
      ...(body ? { body } : {}),
    });
    requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
      authenticated: request.headers.get("authorization") === `Bearer ${backingApi.apiKey}`,
      status: response.status, body: body ? JSON.parse(body) as unknown : null });
    return response;
  } });
  api = { baseUrl: `http://127.0.0.1:${proxy.port}`, apiKey: backingApi.apiKey,
    requestCount: () => backingApi.requestCount(), stop: () => { proxy.stop(true); backingApi.stop(); } };
  configurePrimaryStore();
});

afterEach(async () => {
  try {
    expect(children.size).toBe(0);
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
    for (const output of outputs) for (const value of [api.apiKey, WRONG_KEY, "fixture-inherited"]) {
      expect(`${output.stdout}${output.stderr}`).not.toContain(value);
    }
    expect(process.exit).toBe(savedExit);
    expect(console.error).toBe(savedError);
    expect(globalThis.fetch).toBe(savedFetch);
  } finally {
    for (const child of children) { child.kill(); await child.exited; }
    children.clear();
    process.exit = savedExit;
    console.error = savedError;
    globalThis.fetch = savedFetch;
    try { api?.stop(); } finally {
      try { closeDatabase(); } finally {
        resetSelfHostedConfigCache();
        for (const key of Object.keys(process.env)) {
          if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
        }
        Object.assign(process.env, INHERITED_PROCESS_ENV);
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

async function runCommandChild(args: string[]) {
  const source = `import {Command} from "commander";
    import {registerForwardingCommands} from ${JSON.stringify(new URL("./forwarding.ts", import.meta.url).href)};
    const p=new Command(); p.exitOverride();
    registerForwardingCommands(p,(data,out)=>console.log(JSON.stringify({data,out:String(out??"")})));
    await p.parseAsync(["node","emails",...JSON.parse(process.env.FORWARDING_FIXTURE_ARGS)]);`;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "--eval", source], {
    env: { ...process.env, FORWARDING_FIXTURE_ARGS: JSON.stringify(args) }, stdout: "pipe", stderr: "pipe",
  });
  children.add(child);
  const timeout = setTimeout(() => child.kill(), 4000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    const result = { stdout, stderr, code };
    outputs.push(result);
    return result;
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) { child.kill(); await child.exited; }
    children.delete(child);
  }
}

async function runForwardingCommand(args: string[], register = registerForwardingCommands) {
  if (register === registerForwardingCommands) {
    const result = await runCommandChild(args);
    if (result.code !== 0) throw new Error(`process.exit:${result.code}: ${result.stderr}`);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0]!) as { data: unknown; out: string };
  }
  const program = new Command();
  program.exitOverride();
  let data: unknown;
  const out: string[] = [];
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as typeof process.exit;
  try {
    register(program, (d, formatted) => {
      data = d;
      out.push(String(formatted ?? ""));
    });
    await program.parseAsync(["node", "emails", ...args]);
    return { data, out: out.join("\n") };
  } finally {
    process.exit = originalExit;
  }
}

async function runForwardingCommandExpectingError(args: string[]): Promise<string> {
  const result = await runCommandChild(args);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.length).toBeGreaterThan(0);
  for (const value of [api.apiKey, WRONG_KEY, PRIVATE_TARGET]) expect(result.stderr).not.toContain(value);
  return result.stderr;
}

const STORE_CONFIGURATIONS: ReadonlyArray<[string, () => void]> = [
  ["authenticated API using HASNA_EMAILS_API_KEY", configurePrimaryStore],
  ["authenticated API using EMAILS_SELF_HOSTED_API_KEY", configureApiStore],
];

it("captures a registration exit without terminating the forwarding test runner", async () => {
  const originalExit = process.exit;
  await expect(runForwardingCommand([], () => {
    process.exit(92);
  })).rejects.toThrow("process.exit:92");
  expect(process.exit).toBe(originalExit);
});

describe("forwarding command", () => {
  for (const [name, configure] of STORE_CONFIGURATIONS) {
    it(`creates and lists app-level forwarding rules through the ${name}`, async () => {
      configure();
      const add = await runForwardingCommand(["forwarding", "add", "User@Example.com", "archive@example.net"]);
      const list = await runForwardingCommand(["forwarding", "list"]);

      expect(add.data).toMatchObject({
        source_address: "user@example.com",
        target_address: "archive@example.net",
        mode: "app-copy",
        enabled: true,
      });
      expect(list.out).toContain("user@example.com -> archive@example.net");
      expect(await listForwardingRules()).toHaveLength(1);
      // And the row really is in storage, read through the seam rather than through the
      // command that wrote it.
      const stored = await createSqliteEmailStore({ database: db }).forwarding.list({ limit: 10 });
      expect(stored.ok).toBe(true);
      if (stored.ok) expect(stored.value.map((row) => row["source_address"])).toEqual(["user@example.com"]);
    });

    it(`filters the list by --enabled and --disabled through the ${name}`, async () => {
      configure();
      await runForwardingCommand(["forwarding", "add", "a@x.com", "t@x.com"]);
      await runForwardingCommand(["forwarding", "add", "b@x.com", "t@x.com", "--disabled"]);

      const enabled = await runForwardingCommand(["forwarding", "list", "--enabled"]);
      const disabled = await runForwardingCommand(["forwarding", "list", "--disabled"]);
      expect(enabled.out).toContain("a@x.com -> t@x.com");
      expect(enabled.out).not.toContain("b@x.com");
      expect(disabled.out).toContain("b@x.com -> t@x.com");
      expect(disabled.out).not.toContain("a@x.com");
    });
  }

  it("enables, disables and removes a rule through the authenticated API", async () => {
    // The real ID resolver uses synchronous HTTP; its CLI child leaves this server responsive.
    configurePrimaryStore();
    const add = await runForwardingCommand(["forwarding", "add", "user@example.com", "archive@example.net"]);
    const id = (add.data as { id: string }).id;

    expect((await runForwardingCommand(["forwarding", "disable", id.slice(0, 8)])).out).toContain("disabled");
    expect((await listForwardingRules())[0]?.enabled).toBe(false);
    expect((await runForwardingCommand(["forwarding", "enable", id.slice(0, 8)])).out).toContain("enabled");
    expect((await listForwardingRules())[0]?.enabled).toBe(true);

    expect((await runForwardingCommand(["forwarding", "remove", id.slice(0, 8)])).out).toContain("removed");
    expect(await listForwardingRules()).toEqual([]);
  });

  it("REFUSES `forwarding run` at the command level when the mail lives behind the API", async () => {
    // THE REFUSAL HAS TO REACH THE OPERATOR, not just the function. `emails forwarding run` is the
    // path an operator actually takes, and the wrong outcome here is not an exception — it is a
    // cheerful "forwarding: 0 sent, 0 failed, 0 skipped (0 attempted)" for an inbox this side
    // never looked at. Asserted through the CLI's own error channel, and the setting to unset is
    // asserted too, because a refusal an operator cannot act on is a dead end.
    configureApiStore();
    const errors = await runForwardingCommandExpectingError(["forwarding", "run"]);
    expect(errors).toContain("reads its mail through an Emails API");
    expect(errors).toContain(API_BASE_URL_SETTING);
    // The positive control: nothing was recorded, so the refusal really did precede every read
    // and every write rather than aborting halfway through a run.
    const ledger = db.query("SELECT COUNT(*) AS n FROM forwarding_deliveries").get() as { n: number };
    expect(ledger.n).toBe(0);
  });

  it("reports a bad address as an error rather than creating a rule", async () => {
    configurePrimaryStore();
    const errors = await runForwardingCommandExpectingError(["forwarding", "add", "not-an-address", "t@x.com"]);
    expect(errors).toContain("Invalid email address");
    expect(await listForwardingRules()).toEqual([]);
  });

  it("runs the forwarding pipeline against local storage", async () => {
    // Retained positive capability requirement: canonical run is still unavailable.
    // Keep its original commands, fixture seeds and assertions visibly red, not skipped
    // or replaced by a successful refusal or a direct-library substitute.
    configurePrimaryStore();
    const empty = await runForwardingCommand(["forwarding", "run"]);
    expect(empty.data).toMatchObject({ attempted: 0, sent: 0, failed: 0, skipped: 0 });

    await runForwardingCommand(["forwarding", "add", "user@example.com", "archive@example.net"]);
    db.run(
      `INSERT INTO inbound_emails (id, from_address, to_addresses, subject, text_body, received_at, created_at, is_sent)
       VALUES ('inbound-1', 'sender@elsewhere.test', '["user@example.com"]', 'Hello', 'body',
               datetime('now', '+1 hour'), datetime('now'), 0)`,
    );
    // `inbound_recipients` is DERIVED from `to_addresses` by an AFTER INSERT trigger, so this
    // is `OR IGNORE`, and the row is asserted rather than assumed — the pending-forward join
    // is on this table, and a silently absent recipient would make the run below report zero
    // and pass for the wrong reason.
    db.run(
      "INSERT OR IGNORE INTO inbound_recipients (inbound_email_id, address, domain) VALUES ('inbound-1', 'user@example.com', 'example.com')",
    );
    const recipients = db
      .query("SELECT COUNT(*) AS n FROM inbound_recipients WHERE inbound_email_id = 'inbound-1'")
      .get() as { n: number };
    expect(recipients.n).toBe(1);

    // No provider is configured, so the pipeline records a FAILED delivery rather than
    // sending anything — which is the path that proves `recordForwardingDelivery` is reached
    // through the facade.
    const run = await runForwardingCommand(["forwarding", "run"]);
    expect(run.data).toMatchObject({ attempted: 1, sent: 0, failed: 1, skipped: 0 });
    const ledger = db.query("SELECT status, error FROM forwarding_deliveries").all() as Array<{
      status: string;
      error: string | null;
    }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.status).toBe("failed");
    expect(ledger[0]?.error).toContain("No active provider");
  });
});

async function storedRules(): Promise<ReadonlyArray<Record<string, unknown>>> {
  const result = await fixtureStore().forwarding.list({ limit: 500 });
  if (!result.ok) throw new Error("explicit forwarding fixture read failed");
  return result.value;
}

async function expectConfigurationRefusal(setting: string): Promise<void> {
  const before = await storedRules();
  const count = api.requestCount();
  const accesses = [...resourceAccesses];
  expect(await runForwardingCommandExpectingError(["forwarding", "list"])).toContain(setting);
  expect(api.requestCount()).toBe(count);
  expect(resourceAccesses).toEqual(accesses);
  expect(await storedRules()).toEqual(before);
}

describe("forwarding authenticated fixture boundaries", () => {
  for (const [index, setting] of KEY_VARIANTS.entries()) {
    it(`proves real CRUD wire payloads and backing rows with ${setting}`, async () => {
      STORE_CONFIGURATIONS[index]![1]();
      const added = await runForwardingCommand(["forwarding", "add", "Wire@Example.test", PRIVATE_TARGET,
        "--from", "from@example.test", "--disabled"]);
      const row = added.data as { id: string };
      expect(row.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(await storedRules()).toEqual([expect.objectContaining({ id: row.id,
        source_address: "wire@example.test", target_address: PRIVATE_TARGET,
        from_address: "from@example.test", provider_id: null, enabled: 0 })]);
      const posts = requests.filter(r => r.method === "POST" && r.path === "/v1/forwarding");
      expect(posts).toEqual([expect.objectContaining({ authenticated: true, status: 201, body: {
        source_address: "wire@example.test", target_address: PRIVATE_TARGET, mode: "app-copy",
        provider_id: null, from_address: "from@example.test", enabled: false,
      } })]);
      expect((await runForwardingCommand(["forwarding", "enable", row.id])).data).toMatchObject({ id: row.id, enabled: true });
      expect(requests).toContainEqual(expect.objectContaining({ method: "GET", path: `/v1/forwarding/${row.id}`, status: 200 }));
      expect(requests).toContainEqual(expect.objectContaining({ method: "PATCH", path: `/v1/forwarding/${row.id}`,
        authenticated: true, body: { enabled: true }, status: 200 }));
      expect((await runForwardingCommand(["forwarding", "list", "--source", "wire@example.test", "--enabled"])).data)
        .toEqual([expect.objectContaining({ id: row.id, enabled: true })]);
      expect((await runForwardingCommand(["forwarding", "list", "--disabled"])).data).toEqual([]);
      expect((await runForwardingCommand(["forwarding", "remove", row.id])).data).toMatchObject({ id: row.id });
      expect(requests).toContainEqual(expect.objectContaining({ method: "DELETE", path: `/v1/forwarding/${row.id}`, status: 200 }));
      expect(resourceAccesses).toContain(`remove:${row.id}`);
      expect(await storedRules()).toEqual([]);
    });

    it(`rejects a wrong ${setting} over real HTTP without protected access or disclosure`, async () => {
      await runForwardingCommand(["forwarding", "add", "private@example.test", PRIVATE_TARGET]);
      STORE_CONFIGURATIONS[index]![1]();
      process.env[setting] = WRONG_KEY;
      const before = await storedRules();
      const accesses = [...resourceAccesses];
      const start = requests.length;
      for (const args of [["forwarding", "list"], ["forwarding", "add", "blocked@example.test", "target@example.test"]]) {
        expect(await runForwardingCommandExpectingError(args)).toContain("authentication required");
      }
      const protectedRequests = requests.slice(start).filter(r => r.path !== "/v1/openapi.json");
      expect(protectedRequests.length).toBeGreaterThanOrEqual(2);
      expect(protectedRequests.every(r => r.status === 401 && !r.authenticated)).toBe(true);
      expect(resourceAccesses).toEqual(accesses);
      expect(await storedRules()).toEqual(before);
    });
  }

  it("accepts matching trimmed URL and key aliases over the populated real API", async () => {
    await runForwardingCommand(["forwarding", "add", "matching@example.test", PRIVATE_TARGET]);
    for (const key of EMAILS_API_URL_SETTINGS) process.env[key] = ` ${api.baseUrl} `;
    for (const key of EMAILS_API_KEY_SETTINGS) process.env[key] = ` ${api.apiKey} `;
    const start = requests.length;
    expect((await runForwardingCommand(["forwarding", "list"])).data)
      .toEqual([expect.objectContaining({ source_address: "matching@example.test" })]);
    expect(requests.slice(start).some(r => r.path === "/v1/forwarding" && r.status === 200 && r.authenticated)).toBe(true);
  });

  for (const setting of [...EMAILS_API_URL_SETTINGS, ...EMAILS_API_KEY_SETTINGS]) {
    it(`rejects blank and conflicting ${setting} before any request or mutation`, async () => {
      await runForwardingCommand(["forwarding", "add", "private@example.test", PRIVATE_TARGET]);
      for (const value of ["", "https://conflicting-fixture.invalid"]) {
        configurePrimaryStore();
        if (setting === API_BASE_URL_SETTING || setting === EMAILS_API_KEY_ENV) {
          configureApiStore();
          process.env["EMAILS_SELF_HOSTED_URL"] = api.baseUrl;
        }
        process.env[setting] = value;
        await expectConfigurationRefusal(setting);
      }
    });
  }

  it("rejects missing credentials with populated backing rows and zero network", async () => {
    await runForwardingCommand(["forwarding", "add", "private@example.test", PRIVATE_TARGET]);
    for (const key of API_CREDENTIAL_SETTINGS) delete process.env[key];
    await expectConfigurationRefusal("credential");
  });

  for (const setting of DATABASE_PATH_SETTINGS) {
    it(`rejects present or blank ${setting} without local fallback`, async () => {
      await runForwardingCommand(["forwarding", "add", "private@example.test", PRIVATE_TARGET]);
      for (const value of [":memory:", ""]) {
        configurePrimaryStore();
        process.env[setting] = value;
        await expectConfigurationRefusal(setting);
      }
    });
  }

  it("rejects an invalid address before wire access and preserves populated rules", async () => {
    await runForwardingCommand(["forwarding", "add", "private@example.test", PRIVATE_TARGET]);
    const before = await storedRules();
    const count = api.requestCount();
    const accesses = [...resourceAccesses];
    expect(await runForwardingCommandExpectingError(["forwarding", "add", "not-an-address", "target@example.test"]))
      .toContain("Invalid email address");
    expect(api.requestCount()).toBe(count);
    expect(resourceAccesses).toEqual(accesses);
    expect(await storedRules()).toEqual(before);
  });

  it("rejects unknown and colliding IDs after actual lookup without mutating any row", async () => {
    // Seventeen actual CLI-created UUIDs guarantee a one-hex-digit collision.
    const ids: string[] = [];
    for (let start = 0; start < 17; start += 3) {
      const batch = await Promise.all(Array.from({ length: Math.min(3, 17 - start) }, (_, offset) =>
        runForwardingCommand(["forwarding", "add", `id-${start + offset}@example.test`, "target@example.test"])));
      ids.push(...batch.map(r => (r.data as { id: string }).id));
    }
    expect(new Set(ids).size).toBe(17);
    const prefix = ids.find(id => ids.filter(other => other[0] === id[0]).length > 1)![0]!;
    const before = await storedRules();
    for (const id of ["ffffffff-ffff-4fff-8fff-ffffffffffff", prefix]) {
      const start = requests.length;
      expect(await runForwardingCommandExpectingError(["forwarding", "disable", id])).toContain("Could not resolve ID");
      const wire = requests.slice(start).filter(r => r.path.startsWith("/v1/forwarding"));
      expect(wire.length).toBeGreaterThan(0);
      expect(wire.every(r => r.method === "GET")).toBe(true);
      expect(await storedRules()).toEqual(before);
    }
  });

  for (const fault of ["missing-tenant", "invalid-enabled"] as const) {
    it(`rejects ${fault} from actual HTTP instead of relaxing the selector DTO`, async () => {
      const created = await runForwardingCommand(["forwarding", "add", "dto@example.test", PRIVATE_TARGET]);
      const id = (created.data as { id: string }).id;
      expect((await runForwardingCommand(["forwarding", "disable", id])).data).toMatchObject({ id, enabled: false });
      const before = await storedRules();
      const start = requests.length;
      dtoFault = fault;
      const diagnostic = await runForwardingCommandExpectingError(["forwarding", "enable", id]);
      expect(diagnostic).toContain("returned an invalid successful response");
      expect(diagnostic).toContain(fault === "missing-tenant" ? "body.tenant_id is required" : "body.enabled must be a boolean");
      expect(requests.slice(start)).toContainEqual(expect.objectContaining({ method: "GET", path: `/v1/forwarding/${id}`, status: 200 }));
      expect(requests.slice(start).every(r => r.method === "GET")).toBe(true);
      expect(await storedRules()).toEqual(before);
    });
  }

  it("does not use the populated fixture DB when its configured service is closed", async () => {
    await runForwardingCommand(["forwarding", "add", "private@example.test", PRIVATE_TARGET]);
    const before = await storedRules();
    const accesses = [...resourceAccesses];
    api.stop();
    await runForwardingCommandExpectingError(["forwarding", "list"]);
    expect(resourceAccesses).toEqual(accesses);
    expect(await storedRules()).toEqual(before);
  });

  it("restores exit after unexpected registration and asynchronous action errors", async () => {
    const original = process.exit;
    await expect(runForwardingCommand([], () => { throw new Error("fixture registration error"); }))
      .rejects.toThrow("fixture registration error");
    expect(process.exit).toBe(original);
    await expect(runForwardingCommand(["fixture"], program => {
      program.command("fixture").action(async () => { await Promise.resolve(); process.exit(87); });
    })).rejects.toThrow("process.exit:87");
    expect(process.exit).toBe(original);
  });
});
