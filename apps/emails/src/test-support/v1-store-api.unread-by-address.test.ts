import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../db/database.js";
import { getInboundEmail, setInboundArchivedFlag, setInboundReadFlag, storeInboundEmail } from "../db/inbound.local.js";
import { SqliteMailDataSource } from "../lib/mail-data-source.js";
import { createSqliteEmailStore } from "../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "./v1-store-api.js";

type Window = { limit?: number; offset?: number };
type Rollup = (options: Window) => Promise<Array<{ address: string; unread: number }>>;
let inheritedEnv: NodeJS.ProcessEnv;
let root: string;
let stateRoots: string[];
let store: ReturnType<typeof createSqliteEmailStore>;
let memory: SqliteMailDataSource;
let api: V1StoreApi;
let calls: Window[];
let adapterWindows: Window[];
let idLookups: number;
let sequence: number;

// The service forwards finite query numbers; its SQL store then applies these
// bounds (server/self-hosted/store.ts clampLimit/clampOffset). The raw explicit
// SQLite helper instead defaults to 50 and is not a client-selected transport.
const unread: Rollup = async (options) => {
  calls.push({ ...options });
  return memory.unreadByAddress({
    limit: !options.limit || Number.isNaN(options.limit) ? 100 : Math.min(Math.max(1, Math.floor(options.limit)), 500),
    offset: !options.offset || Number.isNaN(options.offset) || options.offset < 0 ? 0 : Math.min(Math.floor(options.offset), 100_000),
  });
};

function start(callback: Rollup | undefined = unread, supplied = true): void {
  api?.stop();
  api = startV1StoreApi({ store: { ...store, messages: { ...store.messages,
    async resolveMessageId(id) { idLookups++; return store.messages.resolveMessageId(id); },
  } }, ...(supplied ? { unreadByAddress: callback } : {}) });
}

function seed(overrides: Partial<Parameters<typeof storeInboundEmail>[0]> = {}) {
  sequence++;
  return storeInboundEmail({ provider_id: null, message_id: `<rollup-${sequence}@example.test>`,
    in_reply_to_email_id: null, from_address: "sender@example.test", to_addresses: ["first@example.test"],
    cc_addresses: [], subject: "Synthetic unread fixture", text_body: "Fixture body", html_body: null,
    attachments: [], attachment_paths: [], headers: {}, raw_size: 12, received_at: "2026-07-01T00:00:00Z",
    ...overrides }, getDatabase());
}

async function request(query = "", method = "GET", key: string | null = api.apiKey): Promise<Response> {
  return fetch(`${api.baseUrl}/v1/messages/unread-by-address${query}`, {
    method, headers: key === null ? {} : { authorization: `Bearer ${key}` },
  });
}

async function rows(query = ""): Promise<Array<{ address: string; unread: number }>> {
  const response = await request(query);
  expect(response.status).toBe(200);
  const body = await response.json() as { rows: Array<{ address: string; unread: number }> };
  expect(Object.keys(body)).toEqual(["rows"]);
  return body.rows;
}

beforeEach(() => {
  inheritedEnv = { ...process.env };
  root = mkdtempSync(join(tmpdir(), "emails-unread-route-"));
  for (const key of Object.keys(process.env)) {
    if (/^(?:HASNA_)?(?:EMAILS|MAILERY)_/.test(key)) delete process.env[key];
  }
  for (const key of ["HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN", "AWS_PROFILE", "RESEND_API_KEY"]) delete process.env[key];
  stateRoots = Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" }).map(([key, name]) => {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    process.env[key] = path;
    return path;
  });
  process.env.TMPDIR = join(root, "tmp");
  process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(root, "compiler");
  mkdirSync(process.env.TMPDIR, { mode: 0o700 });
  mkdirSync(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, { mode: 0o700 });
  closeDatabase();
  store = createSqliteEmailStore({ database: getDatabase(":memory:") });
  memory = new SqliteMailDataSource();
  const actualRollup = memory.unreadByAddress.bind(memory);
  memory.unreadByAddress = async (options) => {
    adapterWindows.push({ ...options });
    return actualRollup(options);
  };
  calls = [];
  adapterWindows = [];
  idLookups = sequence = 0;
  start();
});

afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
  } finally {
    api?.stop();
    closeDatabase();
    for (const key of Object.keys(process.env)) if (!(key in inheritedEnv)) delete process.env[key];
    Object.assign(process.env, inheritedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});

describe("authenticated unread-by-address fixture", () => {
  it("returns the real empty rollup without interpreting the route as a message id", async () => {
    expect(await rows()).toEqual([]);
    expect(calls).toEqual([{ limit: undefined, offset: undefined }]);
    expect(adapterWindows).toEqual([{ limit: 100, offset: 0 }]);
    expect(idLookups).toBe(0);
    expect(api.requestCount()).toBe(1);
  });

  it("counts real registered and unregistered to recipients, deduplicating normalized recipients and excluding cc", async () => {
    const provider = await store.providers.create({ name: "unread-fixture", type: "sandbox", active: 1 });
    expect(provider.ok).toBe(true);
    const registered = await store.addresses.createAddress({ email: "first@example.test" });
    expect(registered.ok).toBe(true);
    seed({ to_addresses: ["First <first@example.test>", "FIRST@example.test", "second@example.test", "invalid"],
      cc_addresses: ["cc@example.test"] });
    seed();
    expect(await rows()).toEqual([{ address: "first@example.test", unread: 2 }, { address: "second@example.test", unread: 1 }]);
    expect(idLookups).toBe(0);
  });

  it("orders descending counts and then ascending address for ties", async () => {
    seed({ to_addresses: ["z@example.test", "a@example.test", "b@example.test"] });
    seed({ to_addresses: ["z@example.test"] });
    expect(await rows()).toEqual([{ address: "z@example.test", unread: 2 },
      { address: "a@example.test", unread: 1 }, { address: "b@example.test", unread: 1 }]);
  });

  it("excludes read, outbound and archived while retaining unread spam and trash without mutating flags", async () => {
    const kept = seed({ to_addresses: ["kept@example.test"] });
    seed({ to_addresses: ["kept@example.test"], label_ids: ["SPAM"] });
    seed({ to_addresses: ["kept@example.test"], label_ids: ["TRASH"] });
    const read = seed({ to_addresses: ["read@example.test"] });
    setInboundReadFlag(read.id, true, getDatabase());
    const archived = seed({ to_addresses: ["archived@example.test"] });
    setInboundArchivedFlag(archived.id, true, getDatabase());
    seed({ to_addresses: ["outbound@example.test"], label_ids: ["SENT"] });
    expect(await rows()).toEqual([{ address: "kept@example.test", unread: 3 }]);
    expect(getInboundEmail(kept.id, getDatabase())?.is_read).toBe(false);
    expect(getInboundEmail(read.id, getDatabase())?.is_read).toBe(true);
    expect(getInboundEmail(archived.id, getDatabase())?.is_archived).toBe(true);
  });

  it("forwards finite numbers and applies the SQL default, floor and clamps before real adapter queries", async () => {
    const addresses = Array.from({ length: 501 }, (_, i) => `recipient-${String(i).padStart(3, "0")}@example.test`);
    seed({ to_addresses: addresses });
    const cases = [
      ["", undefined, undefined, 100, 0], ["?limit=0", 0, undefined, 100, 0],
      ["?limit=-2", -2, undefined, 1, 0], ["?limit=2.9&offset=1.9", 2.9, 1.9, 2, 1],
      ["?limit=1000", 1000, undefined, 500, 0], ["?limit=1&offset=-2", 1, -2, 1, 0],
      ["?limit=1&offset=100001", 1, 100001, 1, 100000],
      ["?limit=NaN&offset=Infinity", undefined, undefined, 100, 0],
      ["?limit=Infinity&offset=NaN", undefined, undefined, 100, 0],
      ["?limit=&offset=", 0, 0, 100, 0], ["?limit=1&offset=500", 1, 500, 1, 500],
    ] as const;
    for (const [query, parsedLimit, parsedOffset, limit, offset] of cases) {
      expect(await rows(query)).toEqual(addresses.slice(offset, offset + limit).map(address => ({ address, unread: 1 })));
      expect(calls.at(-1)).toEqual({ limit: parsedLimit, offset: parsedOffset });
      expect(adapterWindows.at(-1)).toEqual({ limit, offset });
    }
    expect(calls).toHaveLength(cases.length);
    expect(idLookups).toBe(0);
  });

  it("denies missing and wrong bearer before any callback or message-id query", async () => {
    const sentinel = seed();
    for (const key of [null, "synthetic-wrong-bearer"]) {
      const response = await request("", "GET", key);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ reason: "missing_token" });
    }
    expect(calls).toEqual([]);
    expect(idLookups).toBe(0);
    expect(getInboundEmail(sentinel.id, getDatabase())?.is_read).toBe(false);
    expect(await rows()).toEqual([{ address: "first@example.test", unread: 1 }]);
  });

  it("rejects authenticated wrong methods without invoking the callback", async () => {
    seed();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const response = await request("", method);
      expect(response.status).toBe(405);
    }
    expect(calls).toEqual([]);
    expect(idLookups).toBe(0);
  });

  it("reports an absent callback as an unsupported fixture instead of fake rows or message lookup", async () => {
    seed();
    start(undefined, false);
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unread-by-address is not configured in this fixture", reason: "fixture_unread_by_address_unavailable" });
    expect(calls).toEqual([]);
    expect(idLookups).toBe(0);
  });

  it("propagates callback faults through the existing HTTP 500 path", async () => {
    start(async () => { throw new Error("synthetic unread callback failure"); });
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal error: synthetic unread callback failure" });
    expect(idLookups).toBe(0);
  });

  it("preserves trailing-slash route normalization and still dispatches other message ids normally", async () => {
    const message = seed();
    const rollup = await fetch(`${api.baseUrl}/v1/messages/unread-by-address/`, { headers: { authorization: `Bearer ${api.apiKey}` } });
    expect(rollup.status).toBe(200);
    expect(await rollup.json()).toEqual({ rows: [{ address: "first@example.test", unread: 1 }] });
    expect(idLookups).toBe(0);
    const response = await fetch(`${api.baseUrl}/v1/messages/${message.id}`, { headers: { authorization: `Bearer ${api.apiKey}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: { id: message.id } });
    expect(idLookups).toBeGreaterThan(0);
  });
});
