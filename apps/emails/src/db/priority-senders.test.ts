import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase, type Database } from "./database.js";
import { storeInboundEmail } from "./inbound.sqlite.js";
import {
  addPrioritySenderRuleLocal,
  listPrioritySenderRulesLocal,
  removePrioritySenderRuleLocal,
} from "./priority-senders.js";
import { listMailbox } from "../cli/tui/data.sqlite.js";
import { createSqliteEmailStore } from "../store-sqlite/index.js";

let db: Database;
let inheritedDbPath: string | undefined;

beforeEach(() => {
  inheritedDbPath = process.env.EMAILS_DB_PATH;
  process.env.EMAILS_DB_PATH = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  if (inheritedDbPath === undefined) delete process.env.EMAILS_DB_PATH;
  else process.env.EMAILS_DB_PATH = inheritedDbPath;
});

function storeInbound(id: string, from: string): string {
  return storeInboundEmail({
    provider_id: null,
    message_id: `<${id}@example.test>`,
    in_reply_to_email_id: null,
    from_address: from,
    to_addresses: ["owner@example.net"],
    cc_addresses: [],
    subject: id,
    text_body: id,
    html_body: null,
    attachments: [],
    attachment_paths: [],
    headers: {},
    raw_size: id.length,
    received_at: "2026-08-14T12:00:00.000Z",
  }, db).id;
}

describe("SQLite priority sender persistence", () => {
  it("canonicalizes duplicates, classifies matching mail, and removes rules", () => {
    const address = addPrioritySenderRuleLocal("address", "Person@Example.COM", db);
    const duplicate = addPrioritySenderRuleLocal("ADDRESS", " person@example.com ", db);
    addPrioritySenderRuleLocal("domain", "Example.COM.", db);
    const exactId = storeInbound("exact", "person@example.com");
    const domainId = storeInbound("domain", "other@example.com");
    const negativeId = storeInbound("negative", "other@example.com.evil");

    expect(duplicate).toMatchObject({ id: address.id, kind: "address", value: "person@example.com" });
    expect(listPrioritySenderRulesLocal(db)).toHaveLength(2);
    expect(listMailbox("priority", { limit: 10 }, db).map((message) => message.id).sort()).toEqual([domainId, exactId].sort());
    expect(listMailbox("inbox", { limit: 10 }, db).find((message) => message.id === negativeId)?.is_priority).toBe(false);

    expect(removePrioritySenderRuleLocal(address.id, db)).toBe(true);
    expect(removePrioritySenderRuleLocal(address.id, db)).toBe(false);
    expect(listPrioritySenderRulesLocal(db).map((rule) => rule.value)).toEqual(["example.com"]);
  });

  it("keeps the public SQLite store seam canonical and immutable", async () => {
    const rules = createSqliteEmailStore({ database: db }).prioritySenderRules;
    const first = await rules.create({ kind: "ADDRESS", value: " Person@Example.COM " });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toMatchObject({
      id: "priority:address:person@example.com",
      kind: "address",
      value: "person@example.com",
    });

    const duplicate = await rules.create({ kind: "address", value: "person@example.com" });
    expect(duplicate).toEqual(first);

    const invalid = await rules.create({ kind: "domain", value: "not a domain" });
    expect(invalid).toMatchObject({ ok: false, code: "invalid_input" });

    const update = await rules.update(first.value.id, { value: "other@example.com" });
    expect(update).toMatchObject({ ok: false, code: "invalid_input" });
  });
});
