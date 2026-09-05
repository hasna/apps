import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, type Database } from "./db/database.js";
import { createSqliteEmailStore } from "./store-sqlite/index.js";
import { createHttpEmailStore } from "./store-http/index.js";
import { EmailsApiFault } from "./store-http/outcome.js";
import { createConfiguredEmailStore, planEmailStore } from "./store-resolution.js";
import type { EmailStore } from "./store/email-store.js";
import { collectStatusFacts } from "./lib/status-facts.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV } from "./lib/client-settings.js";
import { renderStatusCount } from "./lib/status-availability.js";
import { validateSelfHostedSdkSuccessResponse } from "./lib/self-hosted-wire.js";
import { formatInboxSyncStatus } from "./lib/inbox-sync-status-format.js";
import type { EmailSystemStatus } from "./lib/status-types.js";
import { emptyMailboxCounts } from "./lib/mail-types.js";

const INPUT = { mailboxSources: [], domainLimit: 2, usableFromLimit: 2, sourceLimit: 1 };
const PRIVATE_MARKER = "synthetic-source-private-field";
const KEY = "synthetic-source-inventory-key";
// This fixture tenancy is DTO shape evidence, not a production principal/RLS test.
const TENANT = "11111111-1111-4111-8111-111111111111";
const CREATED = "2026-07-01T00:00:00.000Z";
let db: Database;
let saved: NodeJS.ProcessEnv;
let exit: typeof process.exit;
let exitCode: typeof process.exitCode;
let nativeFetch: typeof fetch;
let scratch: string;
let roots: string[];
let server: ReturnType<typeof Bun.serve>;
let requests: Array<{ method: string; path: string; limit: number; offset: number; status: number }>;
let served: number;
let clamp: number;
let pageNumber: number;
let transform: (rows: Record<string, unknown>[], page: number) => unknown;
let failure: { page: number; status: number; reason?: string } | null;

function clearSettings(): void {
  for (const key of Object.keys(process.env)) {
    if (/^(?:HASNA_)?(?:EMAILS|MAILERY)_/.test(key)) delete process.env[key];
  }
  for (const key of [...CLIENT_DATABASE_SETTINGS, "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "RESEND_API_KEY"]) delete process.env[key];
}

function snapshot(): unknown[] {
  return db.query("SELECT * FROM mailbox_sources ORDER BY id").all();
}

function seed(count = 3): void {
  db.run("INSERT INTO mailboxes(id,address) VALUES('source-fixture-mailbox','inventory@example.com')");
  const insert = db.query(`INSERT INTO mailbox_sources
    (id,mailbox_id,type,name,status,external_account_id,external_mailbox,settings_json,provider_snapshot_json,last_synced_at,created_at,updated_at)
    VALUES(?,'source-fixture-mailbox','manual',?,'active',?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (let index = 0; index < count; index++) {
      insert.run(`source-${String(index).padStart(6, "0")}`, PRIVATE_MARKER, PRIVATE_MARKER,
        PRIVATE_MARKER, JSON.stringify({ private: PRIVATE_MARKER }), JSON.stringify({ private: PRIVATE_MARKER }),
        index === 0 ? "2026-09-02 01:00:00" : null, CREATED, CREATED);
    }
  })();
}

beforeEach(() => {
  saved = { ...process.env };
  exit = process.exit;
  exitCode = process.exitCode;
  nativeFetch = globalThis.fetch;
  scratch = mkdtempSync(join(tmpdir(), "emails-source-inventory-"));
  clearSettings();
  roots = Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app" }).map(([key, name]) => {
    const path = join(scratch, name);
    mkdirSync(path, { mode: 0o700 });
    process.env[key] = path;
    return path;
  });
  process.env.TMPDIR = join(scratch, "tmp");
  process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(scratch, "compiler");
  mkdirSync(process.env.TMPDIR, { mode: 0o700 });
  mkdirSync(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, { mode: 0o700 });
  closeDatabase();
  db = getDatabase(":memory:");
  requests = [];
  served = 0;
  clamp = 500;
  pageNumber = 0;
  transform = rows => ({ items: rows });
  failure = null;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const entry = { method: request.method, path: url.pathname, limit, offset, status: 200 };
    requests.push(entry);
    const respond = (status: number, body: unknown) => {
      entry.status = status;
      return Response.json(body, { status });
    };
    if (url.hostname !== "127.0.0.1" || request.method !== "GET") return respond(405, { error: "unsupported" });
    if (request.headers.get("authorization") !== `Bearer ${KEY}`) return respond(401, { error: PRIVATE_MARKER, reason: "missing_token" });
    if (["/v1/providers", "/v1/domains", "/v1/addresses"].includes(url.pathname)) {
      const store = createSqliteEmailStore({ database: db });
      const answer = url.pathname === "/v1/providers" ? await store.providers.list({ limit, offset })
        : url.pathname === "/v1/domains" ? await store.domains.listDomains({ limit, offset })
        : await store.addresses.listAddresses({ limit, offset });
      if (!answer.ok) return respond(500, { error: "fixture backing refusal" });
      return respond(200, { items: answer.value });
    }
    if (url.pathname !== "/v1/sources" || [...url.searchParams.keys()].some(key => !["limit", "offset"].includes(key))) {
      return respond(404, { error: "unsupported" });
    }
    pageNumber++;
    if (failure?.page === pageNumber) return respond(failure.status, { error: PRIVATE_MARKER, reason: failure.reason });
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) return respond(422, { error: "invalid paging" });
    const rows = db.query(`SELECT * FROM mailbox_sources ORDER BY status ASC,type ASC,created_at ASC,id ASC LIMIT ? OFFSET ?`)
      .all(Math.min(limit, clamp), offset) as Record<string, unknown>[];
    served += rows.length;
    // Full declared service DTO; extra secret-bearing fields deliberately remain on
    // the wire so the CLIENT projection, not a conveniently empty fixture, is tested.
    const wire = rows.map(row => ({ ...row, tenant_id: TENANT, created_at: CREATED, updated_at: CREATED, extra: PRIVATE_MARKER }));
    return respond(200, transform(wire, pageNumber));
  } });
  process.env[EMAILS_API_URL_ENV] = `http://127.0.0.1:${server.port}`;
  process.env[EMAILS_API_KEY_ENV] = KEY;
});

afterEach(() => {
  try {
    for (const root of roots) expect(readdirSync(root)).toEqual([]);
    expect(process.exit).toBe(exit);
    expect(process.exitCode ?? 0).toBe(exitCode ?? 0);
    expect(globalThis.fetch).toBe(nativeFetch);
  } finally {
    server.stop(true);
    closeDatabase();
    process.exit = exit;
    process.exitCode = exitCode ?? 0;
    globalThis.fetch = nativeFetch;
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(saved, key)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(scratch, { recursive: true, force: true });
  }
});

function http() {
  return createHttpEmailStore({ baseUrl: process.env[EMAILS_API_URL_ENV]!, credential: process.env[EMAILS_API_KEY_ENV]!, timeoutMs: 1000 });
}

async function facts(store?: EmailStore) {
  return collectStatusFacts(INPUT, store);
}

function assertUnread(answer: Awaited<ReturnType<typeof facts>>): void {
  expect(answer.sources.configured.total).toBeNull();
  expect(answer.sources.configured.by_status).toBeNull();
  expect(answer.sources.configured.latest_last_synced_at).toBeNull();
  expect(answer.sources.configured.availability.available).toBe(false);
  expect(JSON.stringify(answer).includes(PRIVATE_MARKER)).toBe(false);
}

describe("read-only configured source inventory", () => {
  it("projects actual populated SQLite and authenticated HTTP rows without mutation", async () => {
    seed();
    db.run("UPDATE mailbox_sources SET status='inactive' WHERE id='source-000001'");
    db.run("UPDATE mailbox_sources SET status='legacy' WHERE id='source-000002'");
    const before = snapshot();
    const direct = createSqliteEmailStore({ database: db });
    for (const store of [direct, http()]) {
      const result = await store.sourceInventory.list({ limit: 500, offset: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected observed inventory");
      expect(result.value.map(row => Object.keys(row).sort())).toEqual(Array(3).fill(["id", "last_synced_at", "status"]));
      expect(result.value.map(row => row.status)).toEqual(["active", "inactive", "legacy"]);
      expect(result.value.map(row => row.id)).toEqual(["source-000000", "source-000001", "source-000002"]);
      expect(JSON.stringify(result).includes(PRIVATE_MARKER)).toBe(false);
      expect(Object.keys(store.sourceInventory)).toEqual(["list"]);
    }
    expect(snapshot()).toEqual(before);
    expect(requests).toEqual([{ method: "GET", path: "/v1/sources", limit: 500, offset: 0, status: 200 }]);
    expect(served).toBe(3);
  });

  it("collects the canonical configured inventory independently of the mailbox-view sample", async () => {
    seed(4);
    const before = snapshot();
    const answer = await facts();
    expect(answer.sources.configured).toMatchObject({ total: 4, by_status: { active: 4 }, latest_last_synced_at: "2026-09-02T01:00:00.000Z",
      availability: { available: true, complete: true, basis: "client_enumeration" } });
    expect(answer.sources.total).toBe(0);
    expect(answer.sources.active).toBeNull();
    expect(answer.sources.items).toEqual([]);
    expect(JSON.stringify(answer).includes(PRIVATE_MARKER)).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(requests.filter(row => row.path === "/v1/sources").map(row => row.offset)).toEqual([0, 3]);
    expect(served).toBe(5);
  });

  it("uses the supplied SQLite connection with capped ordered pages and rejects malformed stored identity", async () => {
    seed(601);
    const store = createSqliteEmailStore({ database: db });
    const before = snapshot();
    const first = await store.sourceInventory.list({ limit: 900, offset: 0 });
    const next = await store.sourceInventory.list({ limit: 900, offset: 500 });
    expect(first.ok && first.value.length).toBe(500);
    expect(next.ok && next.value.length).toBe(101);
    expect(next.ok && next.value[0]?.id).toBe("source-000500");
    const answer = await facts(store);
    expect(answer.sources.configured.total).toBe(601);
    expect(answer.sources.configured.latest_last_synced_at).toBe("2026-09-02T01:00:00.000Z");
    expect(answer.sources.configured.availability.complete).toBe(true);
    expect(snapshot()).toEqual(before);
    db.run("UPDATE mailbox_sources SET id=? WHERE id='source-000000'", [new Uint8Array([1, 2, 3])]);
    await expect(store.sourceInventory.list({ limit: 500, offset: 500 })).rejects.toThrow("invalid metadata");
    assertUnread(await facts(store));
    expect(requests).toEqual([]);
  });

  it("distinguishes a genuinely empty inventory from an unsupported injected store", async () => {
    const empty = await facts();
    expect(empty.sources.configured.total).toBe(0);
    expect(empty.sources.configured.by_status).toEqual({});
    expect(empty.sources.configured.latest_last_synced_at).toBeNull();
    expect(empty.sources.configured.availability.complete).toBe(true);
    expect(empty.gaps["sources.configured.latest_last_synced_at"]).toBeUndefined();
    seed();
    const unsupported = await facts({ ...createSqliteEmailStore({ database: db }), sourceInventory: undefined });
    assertUnread(unsupported);
    expect(unsupported.sources.configured.availability.reason).toStartWith("not_modelled_on_store:no_ingestion_source_repository");
    expect(snapshot()).toHaveLength(3);
    expect(requests.filter(row => row.path === "/v1/sources")).toHaveLength(1);
  });

  it("counts open-domain and prototype-looking statuses without inheriting private fields", async () => {
    seed(7);
    const statuses = ["paused", null, "", "__proto__", "constructor", "toString", "active"];
    transform = rows => ({ items: rows.map(row => ({ ...row, status: statuses[Number(String(row.id).slice(-6))] })) });
    const answer = await facts();
    const counts = answer.sources.configured.by_status!;
    expect(Object.entries(counts).sort()).toEqual(Object.entries({ paused: 1, unknown: 2, ["__proto__"]: 1, constructor: 1, toString: 1, active: 1 }).sort());
    expect(Object.hasOwn(counts, "__proto__")).toBe(true);
    expect(answer.sources.configured.total).toBe(7);
    expect(JSON.stringify(answer).includes(PRIVATE_MARKER)).toBe(false);
  });

  it("rejects a missing credential before I/O and a wrong credential through real401", async () => {
    seed();
    const before = snapshot();
    delete process.env[EMAILS_API_KEY_ENV];
    expect(() => createConfiguredEmailStore()).toThrow();
    expect(requests).toEqual([]);
    process.env[EMAILS_API_KEY_ENV] = "synthetic-wrong-key";
    const store = http();
    try { await store.sourceInventory.list(); throw new Error("unexpected success"); }
    catch (error) { expect(error instanceof EmailsApiFault && error.status === 401).toBe(true); expect(String(error).includes(PRIVATE_MARKER)).toBe(false); }
    expect(requests).toEqual([{ method: "GET", path: "/v1/sources", limit: 100, offset: 0, status: 401 }]);
    expect(served).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it("rejects every blank and nonblank client DB setting before any read", () => {
    seed();
    const before = snapshot();
    expect(CLIENT_DATABASE_SETTINGS).toHaveLength(7);
    for (const setting of CLIENT_DATABASE_SETTINGS) for (const value of ["", ":memory:"]) {
      process.env[setting] = value;
      try { expect(() => createConfiguredEmailStore()).toThrow(); }
      finally { delete process.env[setting]; }
    }
    expect(requests).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  for (const [label, mutate] of [
    ["missing tenant", (row: Record<string, unknown>) => { delete row.tenant_id; }],
    ["missing sync field", (row: Record<string, unknown>) => { delete row.last_synced_at; }],
    ["numeric status", (row: Record<string, unknown>) => { row.status = 1; }],
    ["blank identity", (row: Record<string, unknown>) => { row.id = " "; }],
    ["malformed creation time", (row: Record<string, unknown>) => { row.created_at = PRIVATE_MARKER; }],
  ] as const) it(`fails closed on the full DTO: ${label}`, async () => {
    seed();
    transform = rows => { rows.forEach(mutate); return { items: rows }; };
    const answer = await facts();
    assertUnread(answer);
    expect(answer.sources.configured.availability.reason).toContain("source_unreachable:");
    expect(requests.some(row => row.path === "/v1/sources" && row.status === 200)).toBe(true);
    expect(served).toBe(3);
  });

  it("rejects a malformed envelope instead of pretending the source table is empty", async () => {
    seed();
    transform = rows => ({ data: rows });
    assertUnread(await facts());
    expect(served).toBe(3);
  });

  it("proves the fixture's tenant and additional-field contract against the actual validator", async () => {
    seed();
    const response = await fetch(`${process.env[EMAILS_API_URL_ENV]}/v1/sources`, { headers: { Authorization: `Bearer ${KEY}` } });
    const body = await response.json() as { items: Record<string, unknown>[] };
    expect(response.status).toBe(200);
    expect(() => validateSelfHostedSdkSuccessResponse("GET", "/v1/sources", 200, body)).not.toThrow();
    expect(JSON.stringify(body).includes(PRIVATE_MARKER)).toBe(true);
    delete body.items[0]!.tenant_id;
    expect(() => validateSelfHostedSdkSuccessResponse("GET", "/v1/sources", 200, body)).toThrow();
  });

  for (const [status, reason, category] of [[403, "no_tenant", "fault"], [403, "insufficient_scope", "scope_violation"],
    [404, "missing", "not_found"], [500, "broken", "fault"]] as const) it(`preserves safe ${status}/${reason} failure semantics`, async () => {
    seed();
    failure = { page: 1, status, reason };
    if (category === "fault") {
      try { await http().sourceInventory.list(); throw new Error("unexpected success"); }
      catch (error) { expect(error instanceof EmailsApiFault && error.status === status).toBe(true); expect(String(error).includes(PRIVATE_MARKER)).toBe(false); }
    } else {
      const result = await http().sourceInventory.list();
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected refusal");
      expect(result.code).toBe(category);
      expect(result.message.includes(PRIVATE_MARKER)).toBe(false);
    }
    failure.page = 2;
    assertUnread(await facts());
    expect(served).toBe(0);
  });

  it("discards arbitrary injected source faults and refusal prose before constructing gaps", async () => {
    seed();
    const base = createSqliteEmailStore({ database: db });
    for (const list of [async () => { throw new Error(PRIVATE_MARKER); },
      async () => ({ ok: false as const, code: "scope_violation" as const, status: 403 as const, message: PRIVATE_MARKER })]) {
      const answer = await facts({ ...base, sourceInventory: { list } });
      assertUnread(answer);
      expect(JSON.stringify(answer.gaps).includes(PRIVATE_MARKER)).toBe(false);
    }
    expect(requests).toEqual([]);
  });

  it("does not invoke a thrown error's status accessor while sanitizing the failure", async () => {
    seed();
    let accessed = false;
    const poison = Object.defineProperty({}, "status", { get() { accessed = true; throw new Error(PRIVATE_MARKER); } });
    assertUnread(await facts({ ...createSqliteEmailStore({ database: db }), sourceInventory: { list: async () => { throw poison; } } }));
    expect(accessed).toBe(false);
    expect(requests).toEqual([]);
  });

  it("does not fall back to populated SQLite when the real HTTP connection fails", async () => {
    seed();
    const before = snapshot();
    const store = http();
    server.stop(true);
    assertUnread(await facts({ ...createSqliteEmailStore({ database: db }), sourceInventory: store.sourceInventory }));
    expect(snapshot()).toEqual(before);
    expect(served).toBe(0);
  });

  it("keeps oversized private wire responses out of facts and errors", async () => {
    seed(1);
    transform = rows => ({ items: rows.map(row => ({ ...row, provider_snapshot_json: PRIVATE_MARKER.repeat(350000) })) });
    const answer = await facts();
    assertUnread(answer);
    expect(answer.sources.configured.availability.reason).toContain("source_unreachable:");
    expect(served).toBe(1);
  });

  it("renders only projected source facts and fixed field-gap prose", async () => {
    seed();
    db.run("UPDATE mailbox_sources SET last_synced_at=? WHERE id='source-000001'", [PRIVATE_MARKER]);
    const answer = await facts();
    const plan = planEmailStore();
    expect(plan.store).toBe("api");
    // Presentation fixture: only the source block is under acceptance here. Empty
    // mailbox presentation is verified against this same fixture's empty mail store.
    const messages = await createSqliteEmailStore({ database: db }).messages.listMessages();
    expect(messages.ok && messages.value.items.length === 0).toBe(true);
    const gaps = Object.keys(answer.gaps);
    const status: EmailSystemStatus = {
      // Existing public presentation vocabulary only; no deployment setting is set
      // and no selector resolves the store. Canonical plan above supplies provenance.
      generated_at: CREATED, mode: { current: "self_hosted", label: "Server API",
        source: { kind: "env", name: plan.setting, value: plan.baseUrl }, warning: null },
      database: answer.database, providers: answer.providers, domains: answer.domains, addresses: answer.addresses,
      sources: answer.sources, provisioning: answer.provisioning,
      inbox: { total: 0, unread: 0, latest_received_at: null, inbound_buckets: answer.inboundBuckets, realtime: answer.realtime },
      mailboxes: { counts: emptyMailboxCounts(), folders: [], countsComplete: true },
      gaps: answer.gaps, unavailable: gaps, failures: ["sources.configured.latest_last_synced_at"],
      limitations: gaps.filter(path => path !== "sources.configured.latest_last_synced_at"), incomplete: [],
      degraded: true, limited: true, next_actions: [], cli_equivalents: {},
    };
    const rendered = formatInboxSyncStatus(status);
    expect(rendered).toContain("Server sources: 3");
    expect(rendered).toContain("invalid_source_sync_timestamp");
    expect(rendered.includes("Last sync:")).toBe(false);
    expect(rendered.includes(PRIVATE_MARKER)).toBe(false);
    expect(JSON.stringify(status).includes(PRIVATE_MARKER)).toBe(false);
  });
});

describe("bounded source inventory paging", () => {
  for (const ceiling of [500, 200]) it(`enumerates past a short ${ceiling}-row clamp with anchors and stable tied IDs`, async () => {
    seed(1101);
    clamp = ceiling;
    const before = snapshot();
    const answer = await facts();
    expect(answer.sources.configured.total).toBe(1101);
    expect(answer.sources.configured.by_status).toEqual({ active: 1101 });
    expect(answer.sources.configured.availability.complete).toBe(true);
    const calls = requests.filter(row => row.path === "/v1/sources");
    expect(calls.map(row => row.offset)).toEqual(ceiling === 500 ? [0, 499, 998, 1100] : [0, 199, 398, 597, 796, 995, 1100]);
    expect(calls.every(row => row.limit === 500 && row.method === "GET" && row.status === 200)).toBe(true);
    expect(served).toBe(1101 + calls.length - 1);
    expect(snapshot()).toEqual(before);
  });

  for (const movement of ["duplicate", "forward-shift"] as const) it(`reports ${movement} counts only as lower bounds and never a sample's latest`, async () => {
    seed(700);
    transform = (rows, page) => ({ items: page === 2 ? (movement === "duplicate" ? [rows[0], rows[0], ...rows.slice(1)] : rows.slice(1)) : rows });
    const answer = await facts();
    const configured = answer.sources.configured;
    expect(configured.total).toBeGreaterThan(0);
    expect(configured.availability.available).toBe(true);
    expect(configured.availability.complete).toBe(false);
    expect(configured.availability.reason).toStartWith("enumeration_unstable:");
    expect(renderStatusCount(configured.total, configured.availability)).toStartWith("≥");
    expect(configured.latest_last_synced_at).toBeNull();
    expect(answer.gaps["sources.configured.latest_last_synced_at"]?.available).toBe(false);
    expect(requests.filter(row => row.path === "/v1/sources").length).toBeGreaterThan(1);
  });

  it("keeps the exact40-page budget and refuses latest time for an exhausted inventory", async () => {
    seed(20001);
    const answer = await facts();
    expect(answer.sources.configured.total).toBe(19961);
    expect(answer.sources.configured.by_status).toEqual({ active: 19961 });
    expect(answer.sources.configured.availability.complete).toBe(false);
    expect(answer.sources.configured.availability.reason).toStartWith("enumeration_cap_exceeded:40 pages");
    expect(answer.sources.configured.latest_last_synced_at).toBeNull();
    expect(requests.filter(row => row.path === "/v1/sources")).toHaveLength(40);
    expect(snapshot()).toHaveLength(20001);
  });

  for (const problem of ["401", "500", "malformed"] as const) it(`discards a populated first page on later ${problem}`, async () => {
    seed(700);
    if (problem === "malformed") transform = (rows, page) => ({ items: page === 2 ? rows.map(row => ({ ...row, status: 7 })) : rows });
    else failure = { page: 2, status: Number(problem) };
    const before = snapshot();
    assertUnread(await facts());
    expect(requests.filter(row => row.path === "/v1/sources").map(row => row.offset)).toEqual([0, 499]);
    expect(served).toBeGreaterThanOrEqual(500);
    expect(snapshot()).toEqual(before);
  });
});

describe("source sync instants", () => {
  it("compares actual instants and interprets explicit SQLite times as UTC under different TZs", async () => {
    seed();
    db.run("UPDATE mailbox_sources SET last_synced_at='2026-09-02T03:00:00+03:00' WHERE id='source-000000'");
    db.run("UPDATE mailbox_sources SET last_synced_at='2026-09-01T22:30:00-03:00' WHERE id='source-000001'");
    db.run("UPDATE mailbox_sources SET last_synced_at='2026-09-02 01:45:00.125' WHERE id='source-000002'");
    for (const tz of ["UTC", "Pacific/Honolulu", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      const answer = await facts();
      expect(answer.sources.configured.latest_last_synced_at).toBe("2026-09-02T01:45:00.125Z");
      expect(answer.gaps["sources.configured.latest_last_synced_at"]).toBeUndefined();
    }
  });

  it("accepts a real leap day and preserves sub-millisecond ordering", async () => {
    seed(2);
    db.run("UPDATE mailbox_sources SET last_synced_at='2024-02-29T23:59:59.123450Z' WHERE id='source-000000'");
    db.run("UPDATE mailbox_sources SET last_synced_at='2024-02-29T23:59:59.123451Z' WHERE id='source-000001'");
    const answer = await facts();
    expect(answer.sources.configured.latest_last_synced_at).toBe("2024-02-29T23:59:59.123451Z");
  });

  for (const bad of ["2025-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-09-02T24:00:00Z",
    "2026-09-02T00:60:00Z", "2026-09-02T00:00:60Z", "2026-09-02T00:00:00+24:00", "2026-09-02T00:00:00", "", PRIVATE_MARKER]) {
    it(`retains counts but rejects invalid non-null sync time ${bad === PRIVATE_MARKER ? "private-marker" : JSON.stringify(bad)}`, async () => {
      seed();
      db.run("UPDATE mailbox_sources SET last_synced_at=? WHERE id='source-000001'", [bad]);
      const answer = await facts();
      expect(answer.sources.configured.total).toBe(3);
      expect(answer.sources.configured.by_status).toEqual({ active: 3 });
      expect(answer.sources.configured.availability.complete).toBe(true);
      expect(answer.sources.configured.latest_last_synced_at).toBeNull();
      expect(answer.gaps["sources.configured.latest_last_synced_at"]?.reason).toBe(
        "source_unreachable:invalid_source_sync_timestamp — a source sync timestamp is invalid; inventory counts remain observed",
      );
      expect(JSON.stringify(answer).includes(PRIVATE_MARKER)).toBe(false);
    });
  }

  it("reports an observed absent latest for an all-null completed inventory", async () => {
    seed();
    db.run("UPDATE mailbox_sources SET last_synced_at=NULL");
    const answer = await facts();
    expect(answer.sources.configured.total).toBe(3);
    expect(answer.sources.configured.availability.complete).toBe(true);
    expect(answer.sources.configured.latest_last_synced_at).toBeNull();
    expect(answer.gaps["sources.configured.latest_last_synced_at"]).toBeUndefined();
  });
});
