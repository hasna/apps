import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "./database.js";
import {
  createAudience,
  getAudience,
  listAudiences,
  updateAudience,
  deleteAudience,
  markAudienceSuppressionSynced,
  setContactConsent,
  getContactConsent,
  listContactConsent,
  suppressAddress,
  unsuppressAddress,
  listSuppressions,
  markSuppressionsSynced,
  matchAudienceContacts,
  resolveAudience,
} from "./audiences.js";
import { createContact, updateContact } from "./contacts.js";
import { createTag, addTagToContact } from "./tags.js";
import { createGroup, addContactToGroup } from "./groups.js";
import {
  AudienceNotFoundError,
  ContactNotFoundError,
  DuplicateAudienceIdError,
  InvalidAudienceDefinitionError,
} from "../types/index.js";
import { toAudienceContract, validateAudienceContract } from "../lib/audience-contract.js";
import type { ContactsDatabase } from "./database.js";

let tmpDir: string;
let db: ContactsDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createAudience", () => {
  it("creates an audience with defaults", () => {
    const a = createAudience({
      audience_id: "beta-testers",
      name: "Beta testers",
      predicates: [{ kind: "tag", value: "beta" }],
    }, db);
    expect(a.id).toBeTruthy();
    expect(a.audience_id).toBe("beta-testers");
    expect(a.match).toBe("all");
    expect(a.consent_policy).toBe("opt_in");
    expect(a.predicates).toHaveLength(1);
    expect(a.suppression_synced_at).toBeNull();
  });

  it("rejects duplicate audience_id", () => {
    createAudience({ audience_id: "dupe", name: "A", predicates: [{ kind: "tag", value: "x" }] }, db);
    expect(() =>
      createAudience({ audience_id: "dupe", name: "B", predicates: [{ kind: "tag", value: "y" }] }, db),
    ).toThrow(DuplicateAudienceIdError);
  });

  it("rejects non-slug audience_id", () => {
    expect(() =>
      createAudience({ audience_id: "Not A Slug", name: "A", predicates: [{ kind: "tag", value: "x" }] }, db),
    ).toThrow(InvalidAudienceDefinitionError);
  });

  it("rejects empty predicates", () => {
    expect(() =>
      createAudience({ audience_id: "empty", name: "A", predicates: [] }, db),
    ).toThrow(InvalidAudienceDefinitionError);
  });

  it("rejects attribute predicates without key", () => {
    expect(() =>
      createAudience({ audience_id: "bad", name: "A", predicates: [{ kind: "attribute", value: "x" }] }, db),
    ).toThrow(InvalidAudienceDefinitionError);
  });

  it("rejects in predicates without values", () => {
    expect(() =>
      createAudience({ audience_id: "bad", name: "A", predicates: [{ kind: "tag", op: "in" }] }, db),
    ).toThrow(InvalidAudienceDefinitionError);
  });
});

describe("getAudience / listAudiences / updateAudience / deleteAudience", () => {
  it("looks up by id or slug", () => {
    const a = createAudience({ audience_id: "vips", name: "VIPs", predicates: [{ kind: "tag", value: "vip" }] }, db);
    expect(getAudience(a.id, db).audience_id).toBe("vips");
    expect(getAudience("vips", db).id).toBe(a.id);
  });

  it("throws AudienceNotFoundError for unknown ids", () => {
    expect(() => getAudience("nope", db)).toThrow(AudienceNotFoundError);
  });

  it("lists audiences sorted by slug", () => {
    createAudience({ audience_id: "zeta", name: "Z", predicates: [{ kind: "tag", value: "z" }] }, db);
    createAudience({ audience_id: "alpha", name: "A", predicates: [{ kind: "tag", value: "a" }] }, db);
    expect(listAudiences(db).map((a) => a.audience_id)).toEqual(["alpha", "zeta"]);
  });

  it("updates fields", () => {
    createAudience({ audience_id: "seg", name: "Old", predicates: [{ kind: "tag", value: "x" }] }, db);
    const updated = updateAudience("seg", { name: "New", match: "any", consent_policy: "opt_out" }, db);
    expect(updated.name).toBe("New");
    expect(updated.match).toBe("any");
    expect(updated.consent_policy).toBe("opt_out");
  });

  it("deletes by slug", () => {
    createAudience({ audience_id: "gone", name: "Gone", predicates: [{ kind: "tag", value: "x" }] }, db);
    deleteAudience("gone", db);
    expect(() => getAudience("gone", db)).toThrow(AudienceNotFoundError);
  });
});

describe("audience contract mirror (hasna.audience.v1)", () => {
  it("produces a valid contract document", () => {
    const a = createAudience({
      audience_id: "beta-testers",
      name: "Beta testers",
      match: "any",
      predicates: [
        { kind: "tag", value: "beta" },
        { kind: "attribute", key: "job_title", op: "in", values: ["engineer", "founder"] },
      ],
      consent_policy: "opt_in",
    }, db);
    const doc = toAudienceContract(a);
    expect(doc.schema).toBe("hasna.audience.v1");
    expect(doc.audienceId).toBe("beta-testers");
    expect(doc.definition.match).toBe("any");
    expect(doc.definition.predicates).toHaveLength(2);
    const validated = validateAudienceContract(doc);
    expect(validated.ok).toBe(true);
  });

  it("includes suppressionSyncedAt after sync stamp", () => {
    const a = createAudience({ audience_id: "seg", name: "S", predicates: [{ kind: "tag", value: "x" }] }, db);
    const at = new Date().toISOString();
    const stamped = markAudienceSuppressionSynced(a.id, at, db);
    expect(stamped.suppression_synced_at).toBe(at);
    const doc = toAudienceContract(stamped);
    expect(doc.suppressionSyncedAt).toBe(at);
  });

  it("rejects unknown keys (strict mirror)", () => {
    const a = createAudience({ audience_id: "seg", name: "S", predicates: [{ kind: "tag", value: "x" }] }, db);
    const doc = { ...toAudienceContract(a), rogue: true };
    const validated = validateAudienceContract(doc);
    expect(validated.ok).toBe(false);
  });
});

describe("consent", () => {
  it("sets and reads per-channel consent", () => {
    const c = createContact({ display_name: "Alice" });
    setContactConsent(c.id, "email", "opt_in", "signup-form", db);
    setContactConsent(c.id, "telegram", "opt_out", undefined, db);
    expect(getContactConsent(c.id, "email", db)?.status).toBe("opt_in");
    expect(getContactConsent(c.id, "telegram", db)?.status).toBe("opt_out");
    expect(getContactConsent(c.id, "sms", db)).toBeNull();
    expect(listContactConsent(c.id, db)).toHaveLength(2);
  });

  it("upserts on repeated set", () => {
    const c = createContact({ display_name: "Bob" });
    setContactConsent(c.id, "email", "opt_in", undefined, db);
    setContactConsent(c.id, "email", "opt_out", "unsubscribe", db);
    const record = getContactConsent(c.id, "email", db);
    expect(record?.status).toBe("opt_out");
    expect(record?.source).toBe("unsubscribe");
  });

  it("throws for unknown contact", () => {
    expect(() => setContactConsent("missing", "email", "opt_in", undefined, db)).toThrow(ContactNotFoundError);
  });
});

describe("suppression", () => {
  it("suppresses and unsuppresses addresses", () => {
    suppressAddress({ channel: "email", address: "a@example.com", reason: "bounce" }, db);
    expect(listSuppressions({}, db)).toHaveLength(1);
    unsuppressAddress("email", "a@example.com", db);
    expect(listSuppressions({}, db)).toHaveLength(0);
  });

  it("is idempotent per (channel, address) and resets synced_at", () => {
    const first = suppressAddress({ channel: "email", address: "a@example.com" }, db);
    markSuppressionsSynced([first.id], new Date().toISOString(), db);
    const again = suppressAddress({ channel: "email", address: "a@example.com", reason: "complaint" }, db);
    expect(listSuppressions({}, db)).toHaveLength(1);
    expect(again.id).toBe(first.id);
    expect(again.synced_at).toBeNull();
    expect(again.reason).toBe("complaint");
  });

  it("mirrors an opt-out on the linked contact", () => {
    const c = createContact({ display_name: "Carol", emails: [{ address: "carol@example.com" }] });
    suppressAddress({ channel: "email", address: "carol@example.com", contact_id: c.id, reason: "unsubscribe" }, db);
    expect(getContactConsent(c.id, "email", db)?.status).toBe("opt_out");
  });

  it("filters unsynced entries", () => {
    const a = suppressAddress({ channel: "email", address: "a@example.com" }, db);
    suppressAddress({ channel: "email", address: "b@example.com" }, db);
    markSuppressionsSynced([a.id], new Date().toISOString(), db);
    const unsynced = listSuppressions({ channel: "email", unsyncedOnly: true }, db);
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0]!.address).toBe("b@example.com");
  });
});

describe("matchAudienceContacts", () => {
  it("matches tag predicates", () => {
    const tag = createTag({ name: "beta" }, db);
    const inTag = createContact({ display_name: "In" });
    createContact({ display_name: "Out" });
    addTagToContact(inTag.id, tag.id, db);

    const audience = createAudience({
      audience_id: "beta", name: "Beta", predicates: [{ kind: "tag", value: "beta" }],
    }, db);
    const matched = matchAudienceContacts(audience, db);
    expect(matched.map((m) => m.id)).toEqual([inTag.id]);
  });

  it("matches group predicates by name", () => {
    const group = createGroup(db, { name: "insiders" });
    const member = createContact({ display_name: "Member" });
    createContact({ display_name: "NonMember" });
    addContactToGroup(db, member.id, group.id);

    const audience = createAudience({
      audience_id: "insiders", name: "Insiders", predicates: [{ kind: "group", value: "insiders" }],
    }, db);
    expect(matchAudienceContacts(audience, db).map((m) => m.id)).toEqual([member.id]);
  });

  it("matches attribute predicates on columns and custom fields", () => {
    const eng = createContact({ display_name: "Eng", job_title: "engineer", custom_fields: { machine: "spark01" } });
    createContact({ display_name: "Sales", job_title: "sales" });

    const byColumn = createAudience({
      audience_id: "engineers", name: "Engineers",
      predicates: [{ kind: "attribute", key: "job_title", op: "eq", value: "engineer" }],
    }, db);
    expect(matchAudienceContacts(byColumn, db).map((m) => m.id)).toEqual([eng.id]);

    const byCustom = createAudience({
      audience_id: "spark-users", name: "Spark users",
      predicates: [{ kind: "attribute", key: "machine", op: "eq", value: "spark01" }],
    }, db);
    expect(matchAudienceContacts(byCustom, db).map((m) => m.id)).toEqual([eng.id]);
  });

  it("supports exists / not_exists / in / not_in ops", () => {
    const withTitle = createContact({ display_name: "Titled", job_title: "founder" });
    const withoutTitle = createContact({ display_name: "Untitled" });

    const exists = createAudience({
      audience_id: "titled", name: "T", predicates: [{ kind: "attribute", key: "job_title", op: "exists" }],
    }, db);
    expect(matchAudienceContacts(exists, db).map((m) => m.id)).toEqual([withTitle.id]);

    const notExists = createAudience({
      audience_id: "untitled", name: "U", predicates: [{ kind: "attribute", key: "job_title", op: "not_exists" }],
    }, db);
    expect(matchAudienceContacts(notExists, db).map((m) => m.id)).toEqual([withoutTitle.id]);

    const inOp = createAudience({
      audience_id: "leaders", name: "L",
      predicates: [{ kind: "attribute", key: "job_title", op: "in", values: ["founder", "ceo"] }],
    }, db);
    expect(matchAudienceContacts(inOp, db).map((m) => m.id)).toEqual([withTitle.id]);
  });

  it("combines predicates with match=all vs match=any", () => {
    const tag = createTag({ name: "beta" }, db);
    const both = createContact({ display_name: "Both", job_title: "engineer" });
    const tagOnly = createContact({ display_name: "TagOnly" });
    addTagToContact(both.id, tag.id, db);
    addTagToContact(tagOnly.id, tag.id, db);

    const predicates = [
      { kind: "tag" as const, value: "beta" },
      { kind: "attribute" as const, key: "job_title", op: "eq" as const, value: "engineer" },
    ];
    const all = createAudience({ audience_id: "all-seg", name: "All", match: "all", predicates }, db);
    expect(matchAudienceContacts(all, db).map((m) => m.id)).toEqual([both.id]);

    const any = createAudience({ audience_id: "any-seg", name: "Any", match: "any", predicates }, db);
    expect(matchAudienceContacts(any, db).map((m) => m.id).sort()).toEqual([both.id, tagOnly.id].sort());
  });

  it("excludes archived contacts", () => {
    const tag = createTag({ name: "beta" }, db);
    const archived = createContact({ display_name: "Archived" });
    addTagToContact(archived.id, tag.id, db);
    db.run(`UPDATE contacts SET archived = 1 WHERE id = ?`, [archived.id]);

    const audience = createAudience({ audience_id: "beta", name: "B", predicates: [{ kind: "tag", value: "beta" }] }, db);
    expect(matchAudienceContacts(audience, db)).toHaveLength(0);
  });
});

describe("resolveAudience", () => {
  function betaAudience(policy: "opt_in" | "opt_out" | "transactional" | "none" = "opt_in") {
    return createAudience({
      audience_id: `beta-${policy.replaceAll("_", "-")}`,
      name: "Beta",
      predicates: [{ kind: "tag", value: "beta" }],
      consent_policy: policy,
    }, db);
  }

  function betaContact(name: string, email: string) {
    const tag = db.query(`SELECT id FROM tags WHERE name = 'beta'`).get() as { id: string } | null;
    const tagId = tag?.id ?? createTag({ name: "beta" }, db).id;
    const contact = createContact({ display_name: name, emails: [{ address: email }] });
    addTagToContact(contact.id, tagId, db);
    return contact;
  }

  it("opt_in policy only includes explicit opt-ins", () => {
    const optedIn = betaContact("In", "in@example.com");
    betaContact("Unknown", "unknown@example.com");
    setContactConsent(optedIn.id, "email", "opt_in", undefined, db);

    const resolution = resolveAudience(betaAudience("opt_in").id, "email", db);
    expect(resolution.matched).toBe(2);
    expect(resolution.recipients.map((r) => r.address)).toEqual(["in@example.com"]);
    expect(resolution.excluded).toEqual([
      expect.objectContaining({ reason: "consent" }),
    ]);
  });

  it("opt_out policy includes unknowns but not opt-outs", () => {
    betaContact("Unknown", "unknown@example.com");
    const optedOut = betaContact("Out", "out@example.com");
    setContactConsent(optedOut.id, "email", "opt_out", undefined, db);

    const resolution = resolveAudience(betaAudience("opt_out").id, "email", db);
    expect(resolution.recipients.map((r) => r.address)).toEqual(["unknown@example.com"]);
    expect(resolution.excluded.map((e) => e.reason)).toEqual(["consent"]);
  });

  it("excludes suppressed addresses even under policy none", () => {
    betaContact("Kept", "kept@example.com");
    betaContact("Suppressed", "gone@example.com");
    suppressAddress({ channel: "email", address: "GONE@example.com" }, db);

    const resolution = resolveAudience(betaAudience("none").id, "email", db);
    expect(resolution.recipients.map((r) => r.address)).toEqual(["kept@example.com"]);
    expect(resolution.excluded.map((e) => e.reason)).toEqual(["suppressed"]);
  });

  it("excludes do_not_contact contacts", () => {
    const dnc = betaContact("DNC", "dnc@example.com");
    updateContact(dnc.id, { do_not_contact: true });

    const resolution = resolveAudience(betaAudience("none").id, "email", db);
    expect(resolution.recipients).toHaveLength(0);
    expect(resolution.excluded.map((e) => e.reason)).toEqual(["do_not_contact"]);
  });

  it("excludes contacts without an address on the channel", () => {
    const tag = createTag({ name: "beta" }, db);
    const noEmail = createContact({ display_name: "NoEmail" });
    addTagToContact(noEmail.id, tag.id, db);

    const resolution = resolveAudience(betaAudience("none").id, "email", db);
    expect(resolution.recipients).toHaveLength(0);
    expect(resolution.excluded.map((e) => e.reason)).toEqual(["no_address"]);
  });

  it("resolves telegram handles and sms numbers", () => {
    const tag = createTag({ name: "beta" }, db);
    const contact = createContact({
      display_name: "Multi",
      phones: [{ number: "+15550001111" }],
      social_profiles: [{ platform: "telegram", handle: "@multi" }],
    });
    addTagToContact(contact.id, tag.id, db);

    const audience = betaAudience("none");
    const telegram = resolveAudience(audience.id, "telegram", db);
    expect(telegram.recipients.map((r) => r.address)).toEqual(["@multi"]);
    const sms = resolveAudience(audience.id, "sms", db);
    expect(sms.recipients.map((r) => r.address)).toEqual(["+15550001111"]);
  });

  it("consent is tracked per channel", () => {
    const tag = createTag({ name: "beta" }, db);
    const contact = createContact({
      display_name: "PerChannel",
      emails: [{ address: "pc@example.com" }],
      social_profiles: [{ platform: "telegram", handle: "@pc" }],
    });
    addTagToContact(contact.id, tag.id, db);
    setContactConsent(contact.id, "email", "opt_in", undefined, db);

    const audience = betaAudience("opt_in");
    expect(resolveAudience(audience.id, "email", db).recipients).toHaveLength(1);
    expect(resolveAudience(audience.id, "telegram", db).recipients).toHaveLength(0);
  });

  it("rejects unknown channels", () => {
    const audience = betaAudience("none");
    expect(() => resolveAudience(audience.id, "carrier-pigeon" as never, db)).toThrow(InvalidAudienceDefinitionError);
  });
});
