// getTodaySentCount gates the local send path (assertWarmingLimit throws when
// sent >= limit), so it must count the DOMAIN'S OWN sends today — a total, never a
// windowed share. A newest-N window over ALL domains meant one busy sibling domain
// could crowd a warming domain's sends out of the window entirely: the count came
// back 0, the ramp cap never tripped, and local sends blew straight past the ramp.
//
// The probe here is the runtime proof from the audit that filed the defect: 300
// sends today from warm.test plus 1000 NEWER sends today from noisy.test. Under a
// newest-1000 window the noisy rows fill the window and warm.test counts 0; the
// correct answer is 300.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDatabase, getDatabase, type Database } from "../db/database.js";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSqliteEmailStore } from "../store-sqlite/index.js";
import type { EmailStore } from "../store/email-store.js";
import { startV1StoreApi, type V1StoreApi } from "../test-support/v1-store-api.js";
import {
  API_BASE_URL_SETTING,
} from "../store-resolution.js";
import { getTodaySentCount, getTodaySentCountsByDomain } from "./warming.js";

const PROVIDER = "crowding-provider";
let db: Database;
let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let fixtureRoot: string;
let clientRoots: string[];
let api: V1StoreApi;
let backing: EmailStore;

// The fixture owns explicit SQLite; configured library calls use real authenticated HTTP.
beforeEach(() => {
  INHERITED_PROCESS_ENV = { ...process.env };
  fixtureRoot = mkdtempSync(join(tmpdir(), "emails-warming-library-"));
  clientRoots = [];
  const state: NodeJS.ProcessEnv = {};
  for (const [key, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app" })) {
    const path = join(fixtureRoot, name);
    mkdirSync(path, { mode: 0o700 });
    state[key] = path;
    clientRoots.push(path);
  }
  for (const name of ["tmp", "compiler"]) mkdirSync(join(fixtureRoot, name), { mode: 0o700 });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, state, { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TMPDIR: join(fixtureRoot, "tmp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(fixtureRoot, "compiler"),
    AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1", TZ: "UTC" });
  closeDatabase();
  // Only the fixture server owns this explicit database; default calls use actual HTTP.
  db = getDatabase(":memory:");
  db.run("INSERT INTO providers (id, name, type, active) VALUES (?, ?, 'ses', 1)", [PROVIDER, PROVIDER]);
  backing = createSqliteEmailStore({ database: db, detail: "warming fixture backing" });
  api = startV1StoreApi({ store: backing });
  process.env[API_BASE_URL_SETTING] = api.baseUrl;
  process.env["HASNA_EMAILS_API_KEY"] = api.apiKey;
});

afterEach(() => {
  try {
    for (const path of clientRoots) expect(readdirSync(path)).toEqual([]);
  } finally {
    try {
      api.stop();
      closeDatabase();
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
      }
      Object.assign(process.env, INHERITED_PROCESS_ENV);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});


/** `count` sent-ledger rows from one sender, all stamped `sentAt` (today, UTC). */
function seedSentBatch(idPrefix: string, fromAddress: string, count: number, sentAt: string): void {
  const insert = `INSERT INTO emails
       (id, provider_id, provider_message_id, from_address, to_addresses, cc_addresses,
        bcc_addresses, reply_to, subject, status, has_attachments, attachment_count, tags,
        sent_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, '["client@example.com"]', '[]', '[]', NULL, 's', 'sent', 0, 0, '{}', ?, ?, ?)`;
  for (let i = 0; i < count; i++) {
    db.run(insert, [`${idPrefix}-${i}`, PROVIDER, fromAddress, sentAt, sentAt, sentAt]);
  }
}

describe("getTodaySentCount under cross-domain volume", () => {
  it("counts the warming domain's 300 sends even when a sibling domain sent 1000 newer messages today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // The noisy rows are NEWER than the warm rows, so any newest-first window
    // smaller than the whole day fills up with noisy.test before warm.test.
    seedSentBatch("warm", "ramp@warm.test", 300, `${today}T00:00:01.000Z`);
    seedSentBatch("noisy", "blast@noisy.test", 1000, `${today}T00:00:02.000Z`);

    expect(await getTodaySentCount("warm.test")).toBe(300);
  });

  it("reports totals for every requested domain in the same crowded day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedSentBatch("warm", "ramp@warm.test", 300, `${today}T00:00:01.000Z`);
    seedSentBatch("noisy", "blast@noisy.test", 1000, `${today}T00:00:02.000Z`);

    const counts = await getTodaySentCountsByDomain(["warm.test", "noisy.test", "quiet.test"]);
    expect(counts.get("warm.test")).toBe(300);
    expect(counts.get("noisy.test")).toBe(1000);
    // Zero must still MEAN zero — a domain with no sends today.
    expect(counts.get("quiet.test")).toBe(0);
  });
});

describe("configured crowded-domain HTTP boundary", () => {
  it("reads at least three real pages and includes the unified outbound ledger", async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedSentBatch("warm", "ramp@warm.test", 300, `${today}T00:00:01.000Z`);
    seedSentBatch("noisy", "blast@noisy.test", 1000, `${today}T00:00:02.000Z`);
    const created = await backing.messages.createMessage({ direction: "outbound", from_addr: "other@warm.test",
      to_addrs: ["recipient@example.test"], subject: "unified", received_at: `${today}T00:00:03.000Z` });
    expect(created.ok).toBe(true);
    const before = api.requestCount();
    const counts = await getTodaySentCountsByDomain(["warm.test", "noisy.test", "quiet.test"]);
    expect([...counts]).toEqual([["warm.test", 301], ["noisy.test", 1000], ["quiet.test", 0]]);
    expect(api.requestCount() - before).toBeGreaterThanOrEqual(3);
    expect(db.query("SELECT COUNT(*) AS count FROM emails").get()).toEqual({ count: 1300 });
    expect(db.query("SELECT COUNT(*) AS count FROM inbound_emails").get()).toEqual({ count: 1 });
  });

  it("propagates an actual second-page HTTP refusal rather than reporting a partial total", async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedSentBatch("warm", "ramp@warm.test", 300, `${today}T00:00:01.000Z`);
    seedSentBatch("noisy", "blast@noisy.test", 1000, `${today}T00:00:02.000Z`);
    let pages = 0;
    api.stop();
    api = startV1StoreApi({ store: { ...backing, messages: { ...backing.messages,
      async listMessages(options) {
        pages++;
        if (pages === 2) return { ok: false, code: "capability_unavailable", status: 501,
          message: "synthetic second-page refusal" };
        return backing.messages.listMessages(options);
      },
    } } });
    process.env[API_BASE_URL_SETTING] = api.baseUrl;
    process.env["HASNA_EMAILS_API_KEY"] = api.apiKey;
    await expect(getTodaySentCountsByDomain(["warm.test", "noisy.test"]))
      .rejects.toThrow("synthetic second-page refusal");
    expect(pages).toBe(2);
    expect(api.requestCount()).toBeGreaterThanOrEqual(2);
    expect(db.query("SELECT COUNT(*) AS count FROM emails").get()).toEqual({ count: 1300 });
  });
});
