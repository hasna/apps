import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  createDeal, getDeal, listDeals, updateDeal, deleteDeal, getDealsByStage,
} from "./deals.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createDeal", () => {
  it("creates a deal with minimal fields", () => {
    const deal = createDeal({ title: "Big Deal" });
    expect(deal.id).toBeTruthy();
    expect(deal.title).toBe("Big Deal");
    expect(deal.stage).toBe("lead");
    expect(deal.currency).toBe("USD");
    expect(deal.value_usd).toBeNull();
    expect(deal.contact_id).toBeNull();
    expect(deal.company_id).toBeNull();
    expect(deal.notes).toBeNull();
    expect(deal.close_date).toBeNull();
    expect(deal.created_at).toBeTruthy();
    expect(deal.updated_at).toBeTruthy();
  });

  it("creates a deal with all fields", () => {
    const contact = createContact({ display_name: "Alice" });
    const company = createCompany({ name: "Acme Inc" });
    const deal = createDeal({
      title: "Enterprise Contract",
      contact_id: contact.id,
      company_id: company.id,
      stage: "proposal",
      value_usd: 50000,
      currency: "EUR",
      close_date: "2026-06-01",
      notes: "High priority",
    });
    expect(deal.title).toBe("Enterprise Contract");
    expect(deal.contact_id).toBe(contact.id);
    expect(deal.company_id).toBe(company.id);
    expect(deal.stage).toBe("proposal");
    expect(deal.value_usd).toBe(50000);
    expect(deal.currency).toBe("EUR");
    expect(deal.close_date).toBe("2026-06-01");
    expect(deal.notes).toBe("High priority");
  });
});

describe("getDeal", () => {
  it("returns a deal by id", () => {
    const deal = createDeal({ title: "Test Deal" });
    const found = getDeal(deal.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Test Deal");
  });

  it("returns null for non-existent deal", () => {
    expect(getDeal("non-existent-id")).toBeNull();
  });
});

describe("listDeals", () => {
  it("lists all deals", () => {
    createDeal({ title: "Deal A" });
    createDeal({ title: "Deal B" });
    const deals = listDeals();
    expect(deals).toHaveLength(2);
  });

  it("returns empty array when no deals exist", () => {
    expect(listDeals()).toEqual([]);
  });

  it("filters by stage", () => {
    createDeal({ title: "Lead", stage: "lead" });
    createDeal({ title: "Won", stage: "won" });
    const leads = listDeals({ stage: "lead" });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.title).toBe("Lead");
  });

  it("filters by contact_id", () => {
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    createDeal({ title: "Deal 1", contact_id: c1.id });
    createDeal({ title: "Deal 2", contact_id: c2.id });
    const deals = listDeals({ contact_id: c1.id });
    expect(deals).toHaveLength(1);
    expect(deals[0]!.title).toBe("Deal 1");
  });

  it("filters by company_id", () => {
    const co = createCompany({ name: "Acme" });
    createDeal({ title: "Deal 1", company_id: co.id });
    createDeal({ title: "Deal 2" });
    const deals = listDeals({ company_id: co.id });
    expect(deals).toHaveLength(1);
    expect(deals[0]!.title).toBe("Deal 1");
  });

  it("combines multiple filters", () => {
    const c = createContact({ display_name: "Alice" });
    createDeal({ title: "D1", contact_id: c.id, stage: "lead" });
    createDeal({ title: "D2", contact_id: c.id, stage: "won" });
    createDeal({ title: "D3", stage: "lead" });
    const deals = listDeals({ contact_id: c.id, stage: "lead" });
    expect(deals).toHaveLength(1);
    expect(deals[0]!.title).toBe("D1");
  });
});

describe("updateDeal", () => {
  it("updates deal fields", () => {
    const deal = createDeal({ title: "Old Title", stage: "lead" });
    const updated = updateDeal(deal.id, { title: "New Title", stage: "negotiation", value_usd: 10000 });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("New Title");
    expect(updated!.stage).toBe("negotiation");
    expect(updated!.value_usd).toBe(10000);
  });

  it("returns null for non-existent deal", () => {
    expect(updateDeal("non-existent", { title: "X" })).toBeNull();
  });

  it("clears nullable fields with null", () => {
    const deal = createDeal({ title: "Test", notes: "Some notes", value_usd: 100 });
    const updated = updateDeal(deal.id, { notes: null, value_usd: null });
    expect(updated!.notes).toBeNull();
    expect(updated!.value_usd).toBeNull();
  });

  it("updates updated_at timestamp", () => {
    const deal = createDeal({ title: "Test" });
    const updated = updateDeal(deal.id, { title: "Updated" });
    expect(updated!.updated_at).not.toBe(deal.created_at);
  });
});

describe("deleteDeal", () => {
  it("deletes a deal", () => {
    const deal = createDeal({ title: "To Delete" });
    deleteDeal(deal.id);
    expect(getDeal(deal.id)).toBeNull();
  });

  it("does not throw for non-existent id", () => {
    expect(() => deleteDeal("non-existent")).not.toThrow();
  });
});

describe("getDealsByStage", () => {
  it("groups deals by stage", () => {
    createDeal({ title: "Lead 1", stage: "lead" });
    createDeal({ title: "Lead 2", stage: "lead" });
    createDeal({ title: "Won 1", stage: "won" });
    const grouped = getDealsByStage();
    expect(grouped["lead"]).toHaveLength(2);
    expect(grouped["won"]).toHaveLength(1);
  });

  it("returns empty object when no deals exist", () => {
    const grouped = getDealsByStage();
    expect(Object.keys(grouped)).toHaveLength(0);
  });
});
