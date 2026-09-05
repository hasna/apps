import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, type Database } from "../db/database.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV, StoreConfigurationError } from "./client-settings.js";
import { createSqliteEmailStore } from "../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "../test-support/v1-store-api.js";
import {
  EXPORT_DEFAULT_LIMIT,
  EXPORT_MAX_LIMIT,
  exportEmailsCsv,
  exportEmailsJson,
  exportEventsCsv,
  exportEventsJson,
} from "./export.js";

// BOTH HALVES OF THIS FILE NOW READ THROUGH THE STORE SEAM. The email exports go
// through `listEmails` and the event exports through `listEvents`, and BOTH families
// have collapsed onto the seam — the events half used to drive the out-of-process
// `/v1` stub because its family still had a mode-routed second arm, and that arm is
// gone. Each half uses authenticated HTTP over real memory-backed legacy rows;
// `src/db/emails.test.ts` and `src/db/events.test.ts` cover the same reads against
// BOTH shipped stores. What is asserted here is the EXPORT's own behaviour: its
// default and maximum page, its CSV shape and escaping, and the filters it forwards.
// (Every event export is BOUNDED — `normalizeEventFilters` always supplies a limit —
// and a bounded event read now refuses past the whole-set enumeration budget; at this
// fixture's sizes the walk always completes, and the budget refusal itself is pinned
// in src/db/events.test.ts.)
//
// AND ONE FILTER IS GONE, WHICH IS WHY MOST OF THESE CASES CHANGED SHAPE. `provider_id` is
// no longer answerable: no message projection on the store seam carries a provider, so
// `listEmails` REFUSES the filter rather than ignoring it and returning another provider's
// mail. Every email case that used `provider_id: "p1"` as a convenient narrowing now narrows
// by sender or by date instead, and the refusal itself gets a case — because an export that
// silently widened would be a file that looks right and is not.

const PROVIDER = "p1";
let db: Database;
let inheritedEnv: NodeJS.ProcessEnv;
let originalExit: typeof process.exit;
let originalExitCode: typeof process.exitCode;
let originalFetch: typeof globalThis.fetch;
let originalError: typeof console.error;
let fixtureRoot: string;
let stateRoots: string[];
let api: V1StoreApi;
let requests: Array<{ path: string; method: string; status: number }>;

function clearClientConfiguration(): void {
  for (const key of Object.keys(process.env)) {
    if (/^(?:HASNA_)?(?:EMAILS|MAILERY)_/.test(key)) delete process.env[key];
  }
  for (const key of [...CLIENT_DATABASE_SETTINGS, "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "RESEND_API_KEY"]) delete process.env[key];
}

beforeEach(() => {
  inheritedEnv = { ...process.env };
  originalExit = process.exit;
  originalExitCode = process.exitCode;
  originalFetch = globalThis.fetch;
  originalError = console.error;
  fixtureRoot = mkdtempSync(join(tmpdir(), "emails-lib-configured-"));
  clearClientConfiguration();
  stateRoots = Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app" }).map(([key, name]) => {
    const path = join(fixtureRoot, name);
    mkdirSync(path, { mode: 0o700 });
    process.env[key] = path;
    return path;
  });
  process.env.TMPDIR = join(fixtureRoot, "tmp");
  process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(fixtureRoot, "compiler");
  mkdirSync(process.env.TMPDIR, { mode: 0o700 });
  mkdirSync(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, { mode: 0o700 });
  closeDatabase();
  db = getDatabase(":memory:");
  api = startV1StoreApi({ store: createSqliteEmailStore({ database: db, detail: "explicit library fixture" }) });
  process.env[EMAILS_API_URL_ENV] = api.baseUrl;
  process.env[EMAILS_API_KEY_ENV] = api.apiKey;
  requests = [];
  const observer = function(this: unknown, ...args: Parameters<typeof fetch>) {
    const promise = Reflect.apply(originalFetch, this, args);
    const [input, init] = args;
    void promise.then((response: Response) => requests.push({
      path: new URL(input instanceof Request ? input.url : String(input)).pathname,
      method: init?.method ?? "GET", status: response.status,
    }), () => {});
    return promise;
  };
  globalThis.fetch = Object.assign(observer, originalFetch) as typeof fetch;
});

afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
    expect(process.exit).toBe(originalExit);
    expect(console.error).toBe(originalError);
  } finally {
    api.stop();
    closeDatabase();
    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.exit = originalExit;
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(inheritedEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, inheritedEnv);
    // Bun ignores undefined assignment; retain an unset status's effective zero.
    process.exitCode = originalExitCode ?? 0;
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

/** A ledger row written straight into `emails`, with the id and `sent_at` a case names. */
function seedLedger(id: string, sentAt: string, overrides: Record<string, unknown> = {}): void {
  db.run(
    `INSERT INTO emails
       (id, provider_id, provider_message_id, from_address, to_addresses, cc_addresses,
        bcc_addresses, reply_to, subject, status, has_attachments, attachment_count, tags,
        sent_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, '[]', '[]', NULL, ?, 'sent', 0, 0, '{}', ?, ?, ?)`,
    [
      id,
      PROVIDER,
      (overrides["from_address"] as string) ?? "a@example.com",
      (overrides["to_addresses"] as string) ?? JSON.stringify([`${id}@example.com`]),
      (overrides["subject"] as string) ?? `Subject ${id}`,
      sentAt,
      sentAt,
      sentAt,
    ],
  );
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw, and it resolved");
}

describe("configured export boundary", () => {
  const exporters = [exportEmailsJson, exportEmailsCsv, exportEventsJson, exportEventsCsv];

  it("rejects missing credentials before any export dispatches", async () => {
    delete process.env[EMAILS_API_KEY_ENV];
    const before = api.requestCount();
    for (const run of exporters) await expect(run({})).rejects.toThrow(/API credential is required/);
    expect(api.requestCount()).toBe(before);
    expect(db.query("SELECT COUNT(*) AS n FROM emails").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 0 });
  });

  it("rejects a wrong key at HTTP without producing an empty CSV or JSON export", async () => {
    const wrong = "synthetic-invalid-library-bearer";
    process.env[EMAILS_API_KEY_ENV] = wrong;
    for (const run of exporters) {
      const error = await rejection(run({}));
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(/authentication required|401/i);
      expect(String(error).includes(wrong) || String(error).includes(api.apiKey)).toBe(false);
    }
    expect(requests).toHaveLength(4);
    expect(requests.every(row => row.method === "GET" && row.status === 401)).toBe(true);
    expect(db.query("SELECT COUNT(*) AS n FROM emails").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 0 });
  });

  it("rejects every blank and nonblank database setting before exporting", async () => {
    for (const setting of CLIENT_DATABASE_SETTINGS) for (const value of ["", "synthetic-database-poison"]) {
      process.env[setting] = value;
      const before = api.requestCount();
      for (const run of exporters) {
        const error = await rejection(run({}));
        expect(error).toBeInstanceOf(StoreConfigurationError);
        expect((error as StoreConfigurationError).settings).toContain(setting);
        expect(String(error).includes("synthetic-database-poison")).toBe(false);
      }
      expect(api.requestCount()).toBe(before);
      expect(db.query("SELECT COUNT(*) AS n FROM emails").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 0 });
      delete process.env[setting];
    }
  });
});

describe("email exports, over the store seam", () => {
  beforeEach(() => {
    // `emails.provider_id` is NOT NULL with a foreign key into `providers`.
    db.run("INSERT INTO providers (id, name, type, active) VALUES (?, ?, 'ses', 1)", [PROVIDER, PROVIDER]);
  });

  it("paginates real legacy rows through HTTP without rewriting the ledger", async () => {
    for (let index = 0; index < 501; index++) seedLedger(`http-ledger-${index}`, new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString());
    const rows = JSON.parse(await exportEmailsJson({})) as Array<{ id: string }>;
    expect(rows).toHaveLength(501);
    expect(rows[0]?.id).toBe("http-ledger-500");
    expect(rows[500]?.id).toBe("http-ledger-0");
    expect(requests.filter(row => row.path === "/v1/messages" && row.status === 200)).toHaveLength(2);
    expect(db.query("SELECT COUNT(*) AS n FROM emails").get()).toEqual({ n: 501 });
    expect(db.query("SELECT COUNT(*) AS n FROM inbound_emails").get()).toEqual({ n: 0 });
  });

  it("never emits a partial email export when a later actual page refuses or faults", async () => {
    for (let index = 0; index < 501; index++) seedLedger(`fault-ledger-${index}`, new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString());
    const native = globalThis.fetch;
    for (const status of [400, 503]) for (const run of [exportEmailsJson, exportEmailsCsv]) {
      let pages = 0;
      const intercept = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const response = await native(input, init);
        if (new URL(input instanceof Request ? input.url : String(input)).pathname === "/v1/messages" && ++pages === 2) {
          await response.body?.cancel();
          return new Response(JSON.stringify({ error: "synthetic later-page denial" }), { status, headers: { "Content-Type": "application/json" } });
        }
        return response;
      };
      globalThis.fetch = Object.assign(intercept, native) as typeof fetch;
      try {
        const error = await rejection(run({}));
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toContain(status === 400
          ? "cannot list the sent ledger (invalid_input, 422)"
          : "failed while reading the sent ledger");
        expect(pages).toBe(2);
        expect(db.query("SELECT COUNT(*) AS n FROM emails").get()).toEqual({ n: 501 });
      } finally { globalThis.fetch = native; }
    }
  });

  it("defaults direct email exports to a bounded page", async () => {
    for (let index = 0; index < EXPORT_DEFAULT_LIMIT + 1; index += 1) {
      seedLedger(`default-email-${index}`, new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString());
    }

    const json = JSON.parse(await exportEmailsJson({})) as Array<{ id: string }>;
    const csv = await exportEmailsCsv({});

    expect(json).toHaveLength(EXPORT_DEFAULT_LIMIT);
    expect(csv.split("\n")).toHaveLength(EXPORT_DEFAULT_LIMIT + 1);
  });

  it("caps direct email export limits and normalizes bad offsets", async () => {
    for (let index = 0; index < 3; index += 1) {
      seedLedger(`capped-email-${index}`, new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(), {
        subject: `Capped email export ${index}`,
      });
    }

    const json = JSON.parse(await exportEmailsJson({
      limit: EXPORT_MAX_LIMIT + 1,
      offset: -100,
    })) as Array<{ subject: string }>;

    expect(json).toHaveLength(3);
    expect(json[0]?.subject).toBe("Capped email export 2");
  });

  it("keeps email CSV headers stable and honors the since filter", async () => {
    seedLedger("old-msg", "2026-01-01T00:00:00.000Z", { subject: "Old", to_addresses: JSON.stringify(["old@example.com"]) });
    seedLedger("new-msg", "2026-02-01T00:00:00.000Z", { subject: "New", to_addresses: JSON.stringify(["new@example.com"]) });

    const csv = await exportEmailsCsv({ since: "2026-01-15T00:00:00.000Z" });
    expect(csv.split("\n")[0]).toBe("id,from,to,subject,status,sent_at");
    expect(csv).toContain("new-msg");
    expect(csv).toContain("new@example.com");
    expect(csv).not.toContain("old-msg");

    const json = JSON.parse(await exportEmailsJson({ since: "2026-01-15T00:00:00.000Z" })) as Array<{ id: string }>;
    expect(json.map((email) => email.id)).toEqual(["new-msg"]);
  });

  it("paginates email exports and escapes CSV cells", async () => {
    seedLedger("old-msg", "2026-01-01T00:00:00.000Z", { subject: "Old", to_addresses: JSON.stringify(["old@example.com"]) });
    seedLedger("mid-msg", "2026-02-01T00:00:00.000Z", {
      subject: "Middle, quoted",
      to_addresses: JSON.stringify(["middle@example.com", "audit@example.com"]),
    });
    seedLedger("new-msg", "2026-03-01T00:00:00.000Z", { subject: "New", to_addresses: JSON.stringify(["new@example.com"]) });

    const json = JSON.parse(await exportEmailsJson({ limit: 1, offset: 1 })) as Array<{ id: string }>;
    expect(json.map((email) => email.id)).toEqual(["mid-msg"]);

    const csv = await exportEmailsCsv({ limit: 1, offset: 1 });
    expect(csv).toContain('"[""middle@example.com"",""audit@example.com""]"');
    expect(csv).toContain('"Middle, quoted"');
    expect(csv).not.toContain("new-msg");
  });

  it("filters email exports by canonical sender through display-name From values", async () => {
    seedLedger("kept-msg", "2026-02-01T00:00:00.000Z", {
      from_address: '"Ops Team" <ops@example.com>',
      to_addresses: JSON.stringify(["kept@example.com"]),
      subject: "Kept",
    });
    seedLedger("other-msg", "2026-02-01T00:00:00.000Z", {
      from_address: "other@example.com",
      to_addresses: JSON.stringify(["other@example.com"]),
      subject: "Other",
    });

    const json = JSON.parse(await exportEmailsJson({ from_address: "ops@example.com" })) as Array<{ id: string }>;
    expect(json.map((email) => email.id)).toEqual(["kept-msg"]);

    const csv = await exportEmailsCsv({ from_address: "Ops Team <ops@example.com>" });
    expect(csv).toContain("kept-msg");
    expect(csv).not.toContain("Other");
  });

  // THE FILTER THAT IS GONE, in both directions. An export that quietly ignored `--provider`
  // would write every provider's mail into a file the operator believes is one provider's, and
  // an export that refused unconditionally would take the whole feature down.
  it("REFUSES a provider-filtered export rather than writing every provider's mail", async () => {
    seedLedger("only-msg", "2026-02-01T00:00:00.000Z");

    for (const run of [
      () => exportEmailsJson({ provider_id: PROVIDER }),
      () => exportEmailsCsv({ provider_id: PROVIDER }),
    ]) {
      const error = await rejection(run());
      expect(error.message).toContain("filtered by provider");
    }
  });

  it("still exports when no provider filter is named", async () => {
    seedLedger("only-msg", "2026-02-01T00:00:00.000Z");

    const json = JSON.parse(await exportEmailsJson({})) as Array<{ id: string }>;

    expect(json.map((email) => email.id)).toEqual(["only-msg"]);
  });
});

describe("event exports, over the store seam", () => {
  beforeEach(() => {
    // `events.provider_id` and `events.email_id` carry enforced foreign keys.
    db.run("INSERT INTO providers (id, name, type, active) VALUES ('p1', 'p1', 'ses', 1)");
    db.run("INSERT INTO providers (id, name, type, active) VALUES ('p2', 'p2', 'ses', 1)");
    seedLedger("msg", "2026-01-01T00:00:00.000Z");
  });

  function seedEvent(row: {
    id: string;
    provider_id?: string;
    email_id?: string | null;
    type?: string;
    recipient?: string;
    occurred_at: string;
  }): void {
    db.run(
      `INSERT INTO events (id, email_id, provider_id, provider_event_id, type, recipient, metadata, occurred_at, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, '{}', ?, ?)`,
      [
        row.id,
        row.email_id === undefined ? "msg" : row.email_id,
        row.provider_id ?? "p1",
        row.type ?? "delivered",
        row.recipient ?? "user@example.com",
        row.occurred_at,
        row.occurred_at,
      ],
    );
  }

  it("paginates actual provider-filtered event rows without mixing another provider", async () => {
    for (let index = 0; index < 501; index++) seedEvent({ id: `http-event-${index}`, occurred_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString() });
    seedEvent({ id: "foreign-event", provider_id: "p2", email_id: null, occurred_at: "2026-03-01T00:00:00.000Z" });
    const rows = JSON.parse(await exportEventsJson({ provider_id: "p1" })) as Array<{ id: string }>;
    expect(rows).toHaveLength(501);
    expect(rows[0]?.id).toBe("http-event-500");
    expect(rows[500]?.id).toBe("http-event-0");
    expect(rows.some(row => row.id === "foreign-event")).toBe(false);
    expect(requests.some(row => row.path === "/v1/openapi.json" && row.status === 200)).toBe(true);
    expect(requests.filter(row => row.path === "/v1/events" && row.status === 200).length).toBeGreaterThan(1);
    expect(db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 502 });
  });

  it("never emits partial event CSV or JSON after a later actual page refuses or faults", async () => {
    for (let index = 0; index < 501; index++) seedEvent({ id: `fault-event-${index}`, occurred_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString() });
    const native = globalThis.fetch;
    for (const status of [400, 503]) for (const run of [exportEventsJson, exportEventsCsv]) {
      let pages = 0;
      const intercept = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const response = await native(input, init);
        if (new URL(input instanceof Request ? input.url : String(input)).pathname === "/v1/events" && ++pages === 2) {
          await response.body?.cancel();
          return new Response(JSON.stringify({ error: "synthetic later-page denial" }), { status, headers: { "Content-Type": "application/json" } });
        }
        return response;
      };
      globalThis.fetch = Object.assign(intercept, native) as typeof fetch;
      try {
        const error = await rejection(run({ provider_id: "p1" }));
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toMatch(/refused|faulted/i);
        expect(pages).toBe(2);
        expect(db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 501 });
      } finally { globalThis.fetch = native; }
    }
  });

  it("defaults direct event exports to a bounded page", async () => {
    for (let i = 0; i < EXPORT_DEFAULT_LIMIT + 1; i += 1) {
      seedEvent({
        id: `default-event-${i}`,
        recipient: `user-${i}@example.com`,
        occurred_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 1000).toISOString(),
      });
    }

    const json = JSON.parse(await exportEventsJson({ provider_id: "p1" })) as Array<{ id: string }>;
    const csv = await exportEventsCsv({ provider_id: "p1" });

    expect(json).toHaveLength(EXPORT_DEFAULT_LIMIT);
    expect(csv.split("\n")).toHaveLength(EXPORT_DEFAULT_LIMIT + 1);
  });

  it("caps direct event export limits and normalizes bad offsets", async () => {
    for (let i = 0; i < 3; i += 1) {
      seedEvent({
        id: `capped-event-${i}`,
        recipient: `capped-${i}@example.com`,
        occurred_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
    }

    const json = JSON.parse(await exportEventsJson({
      provider_id: "p1",
      limit: EXPORT_MAX_LIMIT + 1,
      offset: -100,
    })) as Array<{ recipient: string }>;

    expect(json).toHaveLength(3);
    expect(json[0]?.recipient).toBe("capped-2@example.com");
  });

  it("keeps event CSV headers stable and honors provider/type/since filters", async () => {
    seedEvent({ id: "kept-evt", type: "delivered", recipient: "user@example.com", occurred_at: "2026-02-01T00:00:00.000Z" });
    seedEvent({ id: "opened-evt", type: "opened", recipient: "user@example.com", occurred_at: "2026-02-02T00:00:00.000Z" });
    seedEvent({ id: "other-evt", email_id: null, provider_id: "p2", type: "delivered", recipient: "other@example.com", occurred_at: "2026-02-03T00:00:00.000Z" });

    const csv = await exportEventsCsv({ provider_id: "p1", type: "delivered", since: "2026-01-15T00:00:00.000Z" });
    expect(csv.split("\n")[0]).toBe("id,email_id,type,recipient,occurred_at");
    expect(csv).toContain("kept-evt");
    expect(csv).toContain("user@example.com");
    expect(csv).not.toContain("opened");
    expect(csv).not.toContain("other@example.com");

    const json = JSON.parse(await exportEventsJson({ provider_id: "p1", type: "delivered", since: "2026-01-15T00:00:00.000Z" })) as Array<{ id: string }>;
    expect(json.map((event) => event.id)).toEqual(["kept-evt"]);
  });

  it("paginates event exports and honors until filters", async () => {
    seedEvent({ id: "old-evt", recipient: "old@example.com", occurred_at: "2026-01-01T00:00:00.000Z" });
    seedEvent({ id: "mid-evt", recipient: "middle@example.com", occurred_at: "2026-02-01T00:00:00.000Z" });
    seedEvent({ id: "new-evt", recipient: "new@example.com", occurred_at: "2026-03-01T00:00:00.000Z" });

    const json = JSON.parse(await exportEventsJson({
      provider_id: "p1",
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-02-15T00:00:00.000Z",
      limit: 1,
    })) as Array<{ id: string }>;
    expect(json.map((event) => event.id)).toEqual(["mid-evt"]);

    const csv = await exportEventsCsv({ provider_id: "p1", until: "2026-02-15T00:00:00.000Z", limit: 1, offset: 1 });
    expect(csv).toContain("old-evt");
    expect(csv).not.toContain("mid-evt");
    expect(csv).not.toContain("new-evt");
  });
});
