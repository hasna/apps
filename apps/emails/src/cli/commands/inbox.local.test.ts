import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../../db/database.js";
import { getInboundEmail, storeInboundEmail } from "../../db/inbound.local.js";
import { resetMailDataSource, SqliteMailDataSource } from "../../lib/mail-data-source.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV } from "../../lib/client-settings.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";
import { registerInboxCommands } from "./inbox.local.js";

// The registrar under test uses the canonical authenticated HTTP client. Only
// the fixture owns the explicit memory adapter used by the original seeds.
function scrubClientSettings(): void {
  for (const key of Object.keys(process.env)) {
    if (/^(?:HASNA_)?(?:EMAILS|MAILERY)_/.test(key)) delete process.env[key];
  }
  for (const key of ["HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN", "AWS_PROFILE", "RESEND_API_KEY"]) delete process.env[key];
}

let originalEnv: NodeJS.ProcessEnv;
let originalExitCode: typeof process.exitCode;
let originalExit: typeof process.exit;
let originalError: typeof console.error;
let root: string;
let stateRoots: string[];
let api: V1StoreApi;
let statusWrites: number;
let sequence = 0;

type StoreInput = Parameters<typeof storeInboundEmail>[0];

beforeEach(() => {
  originalEnv = { ...process.env };
  originalExitCode = process.exitCode;
  originalExit = process.exit;
  originalError = console.error;
  root = mkdtempSync(join(tmpdir(), "emails-inbox-canonical-"));
  scrubClientSettings();
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
  resetMailDataSource();
  closeDatabase();
  const store = createSqliteEmailStore({ database: getDatabase(":memory:") });
  const memory = new SqliteMailDataSource();
  statusWrites = 0;
  api = startV1StoreApi({ store: { ...store, messages: { ...store.messages,
    async updateMessageStatus(id, patch) { statusWrites++; return store.messages.updateMessageStatus(id, patch); },
  } }, unreadByAddress: options => memory.unreadByAddress({
    // The service SQL store owns these windows; raw SQLite defaults to 50.
    limit: !options.limit || Number.isNaN(options.limit) ? 100 : Math.min(Math.max(1, Math.floor(options.limit)), 500),
    offset: !options.offset || Number.isNaN(options.offset) || options.offset < 0 ? 0 : Math.min(Math.floor(options.offset), 100_000),
  }) });
  process.env[EMAILS_API_URL_ENV] = api.baseUrl;
  process.env[EMAILS_API_KEY_ENV] = api.apiKey;
  sequence = 0;
});

afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
    expect(process.exit).toBe(originalExit);
    expect(console.error).toBe(originalError);
  } finally {
    api?.stop();
    resetMailDataSource();
    closeDatabase();
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    process.exit = originalExit;
    console.error = originalError;
    // Bun ignores assigning undefined; normalize only an unset prior status to 0.
    process.exitCode = originalExitCode ?? 0;
    rmSync(root, { recursive: true, force: true });
  }
});

function seed(overrides: Partial<StoreInput> = {}) {
  sequence += 1;
  return storeInboundEmail({
    provider_id: null,
    message_id: `<local-${sequence}@example.com>`,
    in_reply_to_email_id: null,
    from_address: `sender-${sequence}@example.com`,
    to_addresses: ["me@example.com"],
    cc_addresses: [],
    subject: `Local subject ${sequence}`,
    text_body: `Local body ${sequence}`,
    html_body: null,
    attachments: [],
    attachment_paths: [],
    headers: {},
    raw_size: 100,
    received_at: `2026-07-${String(sequence).padStart(2, "0")}T00:00:00.000Z`,
    ...overrides,
  }, getDatabase());
}

async function runInbox(
  args: string[],
  register: typeof registerInboxCommands = registerInboxCommands,
): Promise<{ data: unknown; formatted: string }> {
  const originalExit = process.exit;
  // Registration and actions can exit directly, outside Commander's override.
  // Keep those failures observable without terminating the remaining cases.
  process.exit = ((code?: number) => { throw new Error(`process.exit:${code ?? process.exitCode ?? 0}`); }) as typeof process.exit;
  try {
    const requestsBefore = api.requestCount();
    const program = new Command();
    program.exitOverride();
    let data: unknown;
    const rendered: string[] = [];
    register(program, (value, formatted) => {
      data = value;
      rendered.push(formatted);
    });
    await program.parseAsync(["node", "emails", ...args]);
    if (register === registerInboxCommands) expect(api.requestCount()).toBeGreaterThan(requestsBefore);
    return { data, formatted: rendered.join("\n") };
  } finally {
    process.exit = originalExit;
  }
}

async function runInboxExpectingExit(args: string[]): Promise<{ error: string; stderr: string }> {
  const originalExit = process.exit;
  const originalError = console.error;
  const errors: string[] = [];
  process.exit = ((code?: number) => { throw new Error(`process.exit:${code ?? 0}`); }) as typeof process.exit;
  console.error = ((message?: unknown) => { errors.push(String(message ?? "")); }) as typeof console.error;
  try {
    await runInbox(args);
    throw new Error("Expected command to exit");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), stderr: errors.join("\n") };
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

describe("local inbox commands", () => {
  it("returns an observable empty list without fabricating rows", async () => {
    const result = await runInbox(["inbox", "list"]);

    expect(result.data).toEqual([]);
    expect(result.formatted).toContain("No mail found");
  });

  it("lists, filters, searches, and bounds local mailbox rows", async () => {
    seed({ subject: "Older unrelated", received_at: "2026-07-01T00:00:00.000Z" });
    const target = seed({
      from_address: "alerts@example.com",
      to_addresses: ["Me <me@example.com>"],
      subject: "Needle alert",
      text_body: "verification payload",
      received_at: "2026-07-03T00:00:00.000Z",
    });
    seed({ subject: "Newest unrelated", to_addresses: ["other@example.com"], received_at: "2026-07-04T00:00:00.000Z" });

    const listed = await runInbox(["inbox", "list", "--to", "me@example.com", "--since", "2026-07-02", "--limit", "1"]);
    expect((listed.data as Array<{ id: string }>).map((row) => row.id)).toEqual([target.id]);
    const searched = await runInbox(["inbox", "search", "verification", "--limit", "5"]);
    expect((searched.data as Array<{ id: string }>).map((row) => row.id)).toEqual([target.id]);
    expect((await runInbox(["inbox", "search", "absent"])).data).toEqual([]);
  });

  it("reads by the displayed short id and honors the keep-unread boundary", async () => {
    const email = seed({ text_body: "Read me" });

    const kept = await runInbox(["inbox", "read", email.id.slice(0, 8), "--keep-unread"]);
    expect(kept.data).toMatchObject({ id: email.id, is_read: false, text_body: "Read me" });
    expect(getInboundEmail(email.id, getDatabase())?.is_read).toBe(false);

    const read = await runInbox(["inbox", "read", email.id.slice(0, 8)]);
    expect(read.data).toMatchObject({ id: email.id, is_read: true });
    expect(getInboundEmail(email.id, getDatabase())?.is_read).toBe(true);
  });

  it("mutates read, starred, archived, and label state through the local data source", async () => {
    const email = seed();

    expect((await runInbox(["inbox", "mark-read", email.id])).data).toMatchObject({ is_read: true });
    expect((await runInbox(["inbox", "star", email.id])).data).toMatchObject({ is_starred: true });
    expect((await runInbox(["inbox", "label", email.id, "urgent"])).data).toMatchObject({ label_ids: ["urgent"] });
    await runInbox(["inbox", "archive", email.id]);
    expect(getInboundEmail(email.id, getDatabase())).toMatchObject({
      is_read: true,
      is_starred: true,
      is_archived: true,
      label_ids: ["urgent"],
    });

    await runInbox(["inbox", "mark-read", email.id, "--unread"]);
    await runInbox(["inbox", "star", email.id, "--undo"]);
    await runInbox(["inbox", "archive", email.id, "--undo"]);
    await runInbox(["inbox", "label", email.id, "urgent", "--remove"]);
    expect(getInboundEmail(email.id, getDatabase())).toMatchObject({
      is_read: false,
      is_starred: false,
      is_archived: false,
      label_ids: [],
    });
  });

  it("reports total and per-recipient unread counts", async () => {
    seed({ to_addresses: ["first@example.com", "second@example.com"] });
    seed({ to_addresses: ["first@example.com"] });

    expect((await runInbox(["inbox", "unread-count"])).data).toEqual({ unread: 2 });
    expect((await runInbox(["inbox", "unread-count", "--by-address"])).data).toEqual([
      { address: "first@example.com", unread: 2 },
      { address: "second@example.com", unread: 1 },
    ]);
  });

  it("refuses invalid folders and missing messages with a nonzero exit", async () => {
    const folder = await runInboxExpectingExit(["inbox", "list", "--folder", "starrred"]);
    expect(folder.error).toBe("process.exit:1");
    expect(folder.stderr).toContain("Unknown folder");

    const missing = await runInboxExpectingExit(["inbox", "read", "missing"]);
    expect(missing.error).toBe("process.exit:1");
    expect(missing.stderr).toMatch(/could not resolve id|not found/i);
  });

  it("deletes and clears persisted local rows with explicit confirmation", async () => {
    const first = seed();
    seed();

    const deleted = await runInbox(["inbox", "delete", first.id, "--yes"]);
    expect(getInboundEmail(first.id, getDatabase())).toBeNull();
    expect(deleted.formatted).toContain("Deleted email");

    const cleared = await runInbox(["inbox", "clear", "--yes"]);
    expect(cleared.formatted).toContain("Cleared 1 email");
    expect((await runInbox(["inbox", "list"])).data).toEqual([]);
  });
});

describe("inbox helper exit containment", () => {
  it("propagates an unexpected registrar exit and restores the previous hook", async () => {
    const previousExit = process.exit;
    await expect(runInbox([], () => { process.exit(73); })).rejects.toThrow("process.exit:73");
    expect(process.exit).toBe(previousExit);
  });

  it("propagates an unexpected action exit and restores the previous hook", async () => {
    const previousExit = process.exit;
    await expect(runInbox(["guard-action"], (program) => {
      program.command("guard-action").action(() => { process.exit(23); });
    })).rejects.toThrow("process.exit:23");
    expect(process.exit).toBe(previousExit);
  });

  it("restores an enclosing exit hook instead of replacing it with the native hook", async () => {
    const previousExit = process.exit;
    const enclosingExit = (() => { throw new Error("enclosing exit hook"); }) as typeof process.exit;
    process.exit = enclosingExit;
    try {
      await expect(runInbox([], () => { process.exit(17); })).rejects.toThrow("process.exit:17");
      expect(process.exit).toBe(enclosingExit);
    } finally {
      process.exit = previousExit;
    }
  });

  it("preserves an ordinary action error and restores the previous hook", async () => {
    const previousExit = process.exit;
    const failure = new Error("ordinary action failure");
    await expect(runInbox(["guard-action"], (program) => {
      program.command("guard-action").action(() => { throw failure; });
    })).rejects.toBe(failure);
    expect(process.exit).toBe(previousExit);
  });

  it("leaves an action exit code observable until per-case cleanup restores its prior value", async () => {
    await runInbox(["guard-action"], (program) => {
      program.command("guard-action").action(() => { process.exitCode = 47; });
    });
    expect(process.exitCode).toBe(47);
  });

  it("continues to execute and render later actions after contained exits", async () => {
    const previousExit = process.exit;
    let invoked = false;
    const result = await runInbox(["guard-action"], (program, output) => {
      program.command("guard-action").action(() => {
        invoked = true;
        output({ completed: true }, "completed action");
      });
    });
    expect(invoked).toBe(true);
    expect(result).toEqual({ data: { completed: true }, formatted: "completed action" });
    expect(process.exit).toBe(previousExit);
  });
});

describe("canonical inbox fixture boundary", () => {
  it("reaches the populated authenticated store through the actual registrar", async () => {
    const message = seed({ subject: "Canonical HTTP sentinel", text_body: "Canonical body preserved",
      html_body: "<p>Canonical body preserved</p>", headers: { "x-fixture": "preserved" } });
    const before = api.requestCount();
    const listed = await runInbox(["inbox", "list"]);
    expect(listed.data).toMatchObject([{ id: message.id, subject: "Canonical HTTP sentinel" }]);
    expect(api.requestCount()).toBeGreaterThan(before);
    const read = await runInbox(["inbox", "read", message.id, "--keep-unread"]);
    expect(read.data).toMatchObject({ id: message.id, text_body: "Canonical body preserved",
      html_body: "<p>Canonical body preserved</p>" });
    // Headers belong to the existing HTTP Message DTO, not SeamMailDetail.
    const raw = await fetch(`${api.baseUrl}/v1/messages/${message.id}`, { headers: { authorization: `Bearer ${api.apiKey}` } });
    expect(raw.status).toBe(200);
    expect(await raw.json()).toMatchObject({ message: { id: message.id, body_text: "Canonical body preserved",
      body_html: "<p>Canonical body preserved</p>", headers: { "x-fixture": "preserved" } } });
    expect(statusWrites).toBe(0);
    expect(getInboundEmail(message.id, getDatabase())?.is_read).toBe(false);
    expect(getInboundEmail(message.id, getDatabase())?.headers).toEqual({ "x-fixture": "preserved" });
  });

  it("keeps the CLI default of 50 distinct from the service default of 100 and its 500-row cap", async () => {
    const recipients = Array.from({ length: 501 }, (_, i) => `window-${String(i).padStart(3, "0")}@example.test`);
    seed({ to_addresses: recipients });
    const direct = await fetch(`${api.baseUrl}/v1/messages/unread-by-address`, { headers: { authorization: `Bearer ${api.apiKey}` } });
    expect(direct.status).toBe(200);
    expect(await direct.json()).toEqual({ rows: recipients.slice(0, 100).map(address => ({ address, unread: 1 })) });
    expect((await runInbox(["inbox", "unread-count", "--by-address"])).data)
      .toEqual(recipients.slice(0, 50).map(address => ({ address, unread: 1 })));
    expect((await runInbox(["inbox", "unread-count", "--by-address", "--limit", "1000"])).data)
      .toEqual(recipients.slice(0, 500).map(address => ({ address, unread: 1 })));
    expect((await runInbox(["inbox", "unread-count", "--by-address", "--limit", "1000", "--offset", "500"])).data)
      .toEqual([{ address: recipients[500], unread: 1 }]);
    expect(statusWrites).toBe(0);
  });

  it("rejects a missing key before HTTP or local mutation", async () => {
    const message = seed();
    delete process.env[EMAILS_API_KEY_ENV];
    const before = api.requestCount();
    const denied = await runInboxExpectingExit(["inbox", "mark-read", message.id]);
    expect(denied.error).toBe("process.exit:1");
    expect(api.requestCount()).toBe(before);
    expect(statusWrites).toBe(0);
    expect(getInboundEmail(message.id, getDatabase())?.is_read).toBe(false);
    expect(denied.stderr).not.toContain(api.apiKey);
  });

  it("rejects a wrong key at the real fixture without mutating or falling back", async () => {
    const message = seed();
    const wrong = "synthetic-inbox-wrong-key";
    process.env[EMAILS_API_KEY_ENV] = wrong;
    const before = api.requestCount();
    const denied = await runInboxExpectingExit(["inbox", "mark-read", message.id]);
    expect(denied.error).toBe("process.exit:1");
    expect(api.requestCount()).toBeGreaterThan(before);
    expect(statusWrites).toBe(0);
    expect(getInboundEmail(message.id, getDatabase())?.is_read).toBe(false);
    expect(denied.stderr).not.toContain(wrong);
    expect(denied.stderr).not.toContain(api.apiKey);
  });

  it("refuses every client database setting without HTTP or local mutation", async () => {
    const message = seed();
    for (const setting of CLIENT_DATABASE_SETTINGS) {
      process.env[setting] = ":memory:";
      const before = api.requestCount();
      try {
        const denied = await runInboxExpectingExit(["inbox", "mark-read", message.id]);
        expect(denied.error).toBe("process.exit:1");
        expect(denied.stderr).toContain(setting);
        expect(api.requestCount()).toBe(before);
        expect(statusWrites).toBe(0);
        expect(getInboundEmail(message.id, getDatabase())?.is_read).toBe(false);
      } finally {
        delete process.env[setting];
      }
    }
  });
});
