// Real async CLI commands use the authenticated loopback API. The explicit
// in-memory adapter backs only that test service, never client configuration.
// This fixture has one bearer identity, not the production role/tenant model:
// mint/revoke success here is not evidence of operator authorization or RLS.
// All keys are synthetic. The minted value stays inside the test and is checked
// for absence from subsequent listings; no host credentials or mail are used.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../../db/database.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";
import { CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, EMAILS_CLIENT_ENV_SECRET_ENV } from "../../lib/client-env.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV,
  EMAILS_API_URL_SETTINGS, RETIRED_EMAILS_SELECTOR_SETTINGS } from "../../lib/client-settings.js";
import { registerSendKeyCommands } from "./sendkey.js";

const OWNER_ID = "owner-sendkey-agent";
const PROVIDER_ID = "provider-sendkey";
const WRONG_KEY = "fixture-wrong-key";
const ORPHAN_KEY = "fixture-orphan-key";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let root: string;
let stateRoots: string[];
let api: V1StoreApi;

function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}

function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

function configurePrivateClient(): void {
  root = mkdtempSync(join(tmpdir(), "emails-sendkey-"));
  stateRoots = [];
  for (const [setting, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    stateRoots.push(path);
    process.env[setting] = path;
  }
  for (const [setting, name] of Object.entries({ TMPDIR: "tmp", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "transpiler" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    process.env[setting] = path;
  }
  for (const setting of [...CLIENT_DATABASE_SETTINGS, ...RETIRED_EMAILS_SELECTOR_SETTINGS,
    ...EMAILS_API_URL_SETTINGS, ...CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, EMAILS_CLIENT_ENV_SECRET_ENV,
    "EMAILS_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME"]) delete process.env[setting];
}

let db: ReturnType<typeof getDatabase>;

async function runSendKeyCommand(args: string[], register = registerSendKeyCommands) {
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`unexpected process.exit(${code ?? 0})`);
  }) as typeof process.exit;
  try {
    const program = new Command();
    program.exitOverride();
    let data: unknown;
    const out: string[] = [];
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

describe("sendkey command exit containment", () => {
  it("restores process.exit when registration unexpectedly exits", async () => {
    const originalExit = process.exit;
    await expect(runSendKeyCommand([], () => { process.exit(92); }))
      .rejects.toThrow("unexpected process.exit(92)");
    expect(process.exit).toBe(originalExit);
  });

  it("restores process.exit when an asynchronous action unexpectedly exits", async () => {
    const originalExit = process.exit;
    await expect(runSendKeyCommand(["exit-witness"], (program) => {
      program.command("exit-witness").action(async () => {
        await Promise.resolve();
        process.exit(87);
      });
    })).rejects.toThrow("unexpected process.exit(87)");
    expect(process.exit).toBe(originalExit);
  });
});

/** An ISO instant `seconds` after a fixed epoch, so seeded order is unambiguous. */
function stamp(seconds: number): string {
  return new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
}

/**
 * A send key written straight into the table.
 *
 * `key_hash` is NOT A HASH: the column is `NOT NULL UNIQUE`, so the seed has to put something
 * unique there, and obvious filler is the honest choice. Nothing asserts on it.
 */
function seedKey(
  id: string,
  ownerId: string,
  createdAt: string,
  overrides: { label?: string | null; prefix?: string; revoked_at?: string | null } = {},
): void {
  db.run(
    `INSERT INTO send_keys (id, owner_id, key_hash, prefix, label, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ownerId,
      `not-a-hash-${id}`,
      overrides.prefix ?? "esk_00000000",
      overrides.label ?? null,
      createdAt,
      overrides.revoked_at ?? null,
    ],
  );
}

/**
 * A `/v1` service that serves ONE send key with a null `owner_id`, and nothing else.
 *
 * Deliberately tiny and local: the shared store-backed fixture
 * (`src/test-support/v1-store-api.ts`) translates every request into a real store, and both
 * real stores available in a test process are backed by the SQLite schema, whose
 * `send_keys.owner_id` is `NOT NULL`. This row is legal in the self-hosted Postgres schema
 * and cannot be produced by either of them, so it is served directly. It answers the
 * `{ items: [...] }` envelope and the empty second page that the enumeration terminates on,
 * both taken from the real route contract.
 */
function startNullOwnerSendKeyService(): { baseUrl: string; stop: () => void } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("authorization") !== `Bearer ${ORPHAN_KEY}`) {
        return Response.json({ error: "authentication required" }, { status: 401 });
      }
      if (url.pathname !== "/v1/send-keys") return Response.json({ error: "not found" }, { status: 404 });
      if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const items = offset === 0
        ? [{
            id: "sk-orphan",
            owner_id: null,
            prefix: "esk_00000000",
            label: "orphan",
            last_used_at: null,
            revoked_at: null,
            created_at: stamp(1),
            updated_at: stamp(1),
          }]
        : [];
      return Response.json({ items });
    },
  });
  return { baseUrl: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

beforeEach(() => {
  captureInheritedProcessEnv();
  configurePrivateClient();
  closeDatabase();
  db = getDatabase(":memory:");
  db.run("INSERT INTO providers (id, name, type, active) VALUES (?, ?, 'sandbox', 1)", [PROVIDER_ID, PROVIDER_ID]);
  db.run("INSERT INTO owners (id, type, name, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?)", [
    OWNER_ID,
    "sendkey-agent",
    stamp(0),
    stamp(0),
  ]);
  api = startV1StoreApi({ store: createSqliteEmailStore({ database: db }) });
  process.env[EMAILS_API_URL_ENV] = api.baseUrl;
  process.env[EMAILS_API_KEY_ENV] = api.apiKey;
  resetSelfHostedConfigCache();
});

afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
  } finally {
    api?.stop();
    closeDatabase();
    resetSelfHostedConfigCache();
    restoreInheritedProcessEnv();
    rmSync(root, { recursive: true, force: true });
  }
  expect({ ...process.env }).toEqual(INHERITED_PROCESS_ENV);
});

describe("sendkey list command", () => {
  it("paginates send keys and displays owner names without leaking hashes", async () => {
    for (let i = 0; i < 5; i += 1) {
      seedKey(`sk-${i}`, OWNER_ID, stamp(i + 1), { label: `key-${i}`, prefix: `pf${i}` });
    }

    const result = await runSendKeyCommand(["sendkey", "list", "--owner", "sendkey-agent", "--limit", "2", "--offset", "1"]);
    const data = result.data as Array<Record<string, unknown> & { label: string | null; owner_id: string | null }>;

    expect(data.map((key) => key.label)).toEqual(["key-3", "key-2"]);
    expect(data.every((key) => key.owner_id === OWNER_ID)).toBe(true);
    expect(data.every((key) => !("key_hash" in key))).toBe(true);
    expect(result.out).toContain("sendkey-agent");
    expect(result.out).not.toContain("key-4");
  });

  it("renders a key whose owner is gone as '(no owner)' rather than blank", async () => {
    // A MEASURED SCHEMA ASYMMETRY, and the reason this one case configures an API instead of
    // the local file. `send_keys.owner_id` is `TEXT NOT NULL` in the local SQLite schema
    // (src/db/database.ts) and plain `TEXT` — NULLABLE — in the self-hosted Postgres schema
    // (src/server/self-hosted/migrations.ts), so a key that outlived its owner is unreachable
    // through one store and perfectly ordinary through the other. The seam types it
    // `string | null` for exactly that reason, and the command used to call `.slice(0, 8)` on
    // it unconditionally. A key bound to nobody is the row a revocation review most needs to
    // see, so it has to render as something a reader can act on.
    //
    // The service is a few lines rather than the shared fixture because the shared fixture is
    // backed by the same SQLite schema, so it cannot serve this row either.
    const service = startNullOwnerSendKeyService();
    try {
      process.env[EMAILS_API_URL_ENV] = service.baseUrl;
      process.env[EMAILS_API_KEY_ENV] = ORPHAN_KEY;

      const result = await runSendKeyCommand(["sendkey", "list"]);

      expect(result.out).toContain("(no owner)");
      expect(result.out).toContain("orphan");
      const rows = result.data as Array<{ owner_id: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.owner_id).toBeNull();
    } finally {
      service.stop();
    }
  });

  it("says so plainly when there are no keys", async () => {
    const result = await runSendKeyCommand(["sendkey", "list"]);

    expect(result.data).toEqual([]);
    expect(result.out).toContain("No send keys.");
  });
});

describe("sendkey create command", () => {
  it("mints a send key and returns the token once", async () => {
    const result = await runSendKeyCommand(["sendkey", "create", "sendkey-agent", "--label", "ci"]);
    const data = result.data as { id: string; token: string; owner_id: string; label: string | null };

    expect(data.token).toMatch(/^esk_/);
    expect(data.owner_id).toBe(OWNER_ID);
    expect(data.label).toBe("ci");
    expect(data.id.length).toBeGreaterThan(0);
    expect(result.out).toContain("Store it now");

    const list = await runSendKeyCommand(["sendkey", "list", "--owner", "sendkey-agent"]);
    const keys = list.data as Array<Record<string, unknown> & { id: string }>;
    expect(keys.map((k) => k.id)).toContain(data.id);
    expect(keys.every((k) => !("key_hash" in k))).toBe(true);
    // The listing NEVER carries the token, on any surface.
    expect(list.out).not.toContain(data.token);
  });
});

describe("sendkey revoke command", () => {
  it("reports a revocation only when one happened", async () => {
    // THE ANSWER USED TO BE DISCARDED: the command called `revokeSendKey(id)` and printed the
    // success line unconditionally, so re-revoking reported a revocation that did not happen
    // and stamped nothing.
    seedKey("sk-live", OWNER_ID, stamp(1), { label: "live" });

    const first = await runSendKeyCommand(["sendkey", "revoke", "sk-live"]);
    expect(first.out).toContain("Revoked send key");
    expect((first.data as { revoked: boolean }).revoked).toBe(true);

    const second = await runSendKeyCommand(["sendkey", "revoke", "sk-live"]);
    expect(second.out).toContain("already revoked");
    expect(second.out).not.toContain("✓ Revoked send key");
    expect((second.data as { revoked: boolean }).revoked).toBe(false);
  });
});

describe("sendkey check command", () => {
  it("answers the scope question from the configured store", async () => {
    db.run(
      `INSERT INTO addresses (id, provider_id, email, status, verified, owner_id, administrator_id, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
      ["a1", PROVIDER_ID, "ops@x.com", OWNER_ID, OWNER_ID, stamp(0), stamp(0)],
    );

    const allowed = await runSendKeyCommand(["sendkey", "check", "sendkey-agent", "ops@x.com"]);
    expect((allowed.data as { authorized: boolean }).authorized).toBe(true);
    expect(allowed.out).toContain("may send from");

    const denied = await runSendKeyCommand(["sendkey", "check", "sendkey-agent", "other@x.com"]);
    expect((denied.data as { authorized: boolean }).authorized).toBe(false);
    expect(denied.out).toContain("may NOT send from");
  });
});

function fixtureRows() {
  return ["providers", "owners", "send_keys", "addresses"].map((table) =>
    db.query(`SELECT * FROM ${table} ORDER BY id`).all());
}

async function expectRefusal(args: string[], diagnostic: RegExp) {
  const originalError = console.error;
  const originalExit = process.exit;
  const errors: string[] = [];
  const outputs: unknown[] = [];
  console.error = (...values: unknown[]) => { errors.push(values.map(String).join(" ")); };
  try {
    await expect(runSendKeyCommand(args, (program, output) => {
      registerSendKeyCommands(program, (data, formatted) => {
        outputs.push({ data, formatted });
        output(data, formatted);
      });
    })).rejects.toThrow("unexpected process.exit(1)");
    expect(process.exit).toBe(originalExit);
    expect(outputs).toEqual([]);
    const stderr = errors.join("\n");
    expect(stderr).toMatch(diagnostic);
    for (const value of [api.apiKey, ORPHAN_KEY, WRONG_KEY, "fixture-inherited", "not-a-hash-"]) {
      expect(stderr).not.toContain(value);
    }
  } finally {
    console.error = originalError;
  }
}

describe("sendkey authenticated fixture boundaries", () => {
  it("reads populated owner-scoped keys over HTTP without leaking or mutating fixture rows", async () => {
    seedKey("sk-owned", OWNER_ID, stamp(1), { label: "owned key" });
    db.run("INSERT INTO owners (id, type, name, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?)",
      ["owner-other", "other-agent", stamp(0), stamp(0)]);
    seedKey("sk-other", "owner-other", stamp(2), { label: "other owner's key" });
    const before = fixtureRows();
    const requests = api.requestCount();
    const result = await runSendKeyCommand(["sendkey", "list", "--owner", OWNER_ID]);
    expect((result.data as Array<{ id: string }>).map((row) => row.id)).toEqual(["sk-owned"]);
    expect(api.requestCount()).toBeGreaterThan(requests);
    expect(fixtureRows()).toEqual(before);
    for (const value of [api.apiKey, ORPHAN_KEY, WRONG_KEY, "key_hash", "not-a-hash-", "sk-other"]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("rejects a wrong bearer key without revoking a populated key or printing protected rows", async () => {
    seedKey("sk-protected", OWNER_ID, stamp(1), { label: "protected key" });
    const before = fixtureRows();
    const requests = api.requestCount();
    process.env[EMAILS_API_KEY_ENV] = WRONG_KEY;
    await expectRefusal(["sendkey", "revoke", "sk-protected"], /401|unauthorized|authentication/i);
    expect(api.requestCount()).toBeGreaterThan(requests);
    expect(fixtureRows()).toEqual(before);
  });

  it("rejects a missing bearer key before requests without revoking the populated key", async () => {
    seedKey("sk-protected", OWNER_ID, stamp(1), { label: "protected key" });
    const before = fixtureRows();
    const requests = api.requestCount();
    delete process.env[EMAILS_API_KEY_ENV];
    await expectRefusal(["sendkey", "revoke", "sk-protected"], /An Emails API credential is required/);
    expect(api.requestCount()).toBe(requests);
    expect(fixtureRows()).toEqual(before);
  });

  it.each(CLIENT_DATABASE_SETTINGS)("rejects client DB setting %s before requests or fixture mutations", async (setting) => {
    seedKey("sk-protected", OWNER_ID, stamp(1), { label: "protected key" });
    const before = fixtureRows();
    const requests = api.requestCount();
    for (const value of [":memory:", ""]) {
      process.env[setting] = value;
      await expectRefusal(["sendkey", "revoke", "sk-protected"], /cannot configure an Emails client/);
      expect(api.requestCount()).toBe(requests);
      expect(fixtureRows()).toEqual(before);
    }
  });

  it("restricts the orphan-owner fixture to authenticated loopback GETs and preserves the terminal page", async () => {
    const service = startNullOwnerSendKeyService();
    try {
      expect(new URL(service.baseUrl).hostname).toBe("127.0.0.1");
      const url = `${service.baseUrl}/v1/send-keys`;
      for (const headers of [{}, { authorization: `Bearer ${WRONG_KEY}` }]) {
        const response = await fetch(url, { headers });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "authentication required" });
      }
      const headers = { authorization: `Bearer ${ORPHAN_KEY}` };
      const post = await fetch(url, { method: "POST", headers });
      expect(post.status).toBe(405);
      expect(await post.json()).toEqual({ error: "method not allowed" });
      const other = await fetch(`${service.baseUrl}/v1/owners`, { headers });
      expect(other.status).toBe(404);
      expect(await other.json()).toEqual({ error: "not found" });
      const first = await fetch(`${url}?offset=0`, { headers });
      expect(first.status).toBe(200);
      const body = await first.json() as { items: Array<{ id: string; owner_id: string | null }> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.id).toBe("sk-orphan");
      expect(body.items[0]?.owner_id).toBeNull();
      const terminal = await fetch(`${url}?offset=1`, { headers });
      expect(terminal.status).toBe(200);
      expect(await terminal.json()).toEqual({ items: [] });
    } finally {
      service.stop();
    }
  });
});
