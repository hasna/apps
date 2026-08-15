import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  logVendorCommunication, listVendorCommunications, updateVendorCommunication,
  deleteVendorCommunication, listPendingFollowUps, listMissingInvoices, markFollowUpDone,
} from "./vendor-comms.js";
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

describe("logVendorCommunication", () => {
  it("creates a communication with minimal fields", () => {
    const co = createCompany({ name: "Vendor Co" });
    const comm = logVendorCommunication({ company_id: co.id, comm_date: "2026-03-15" });
    expect(comm.id).toBeTruthy();
    expect(comm.company_id).toBe(co.id);
    expect(comm.comm_date).toBe("2026-03-15");
    expect(comm.type).toBe("email");
    expect(comm.direction).toBe("outbound");
    expect(comm.status).toBe("sent");
    expect(comm.contact_id).toBeNull();
    expect(comm.subject).toBeNull();
    expect(comm.body).toBeNull();
    expect(comm.invoice_amount).toBeNull();
    expect(comm.invoice_currency).toBeNull();
    expect(comm.invoice_ref).toBeNull();
    expect(comm.follow_up_date).toBeNull();
    expect(comm.follow_up_done).toBe(false);
    expect(comm.created_at).toBeTruthy();
  });

  it("creates a communication with all fields", () => {
    const co = createCompany({ name: "Vendor Co" });
    const c = createContact({ display_name: "Alice" });
    const comm = logVendorCommunication({
      company_id: co.id,
      contact_id: c.id,
      comm_date: "2026-03-20",
      type: "call",
      direction: "inbound",
      subject: "Invoice inquiry",
      body: "Requesting invoice for March",
      status: "awaiting_response",
      invoice_amount: 5000,
      invoice_currency: "USD",
      invoice_ref: "INV-2026-001",
      follow_up_date: "2026-04-01",
      follow_up_done: false,
    });
    expect(comm.contact_id).toBe(c.id);
    expect(comm.type).toBe("call");
    expect(comm.direction).toBe("inbound");
    expect(comm.subject).toBe("Invoice inquiry");
    expect(comm.body).toBe("Requesting invoice for March");
    expect(comm.status).toBe("awaiting_response");
    expect(comm.invoice_amount).toBe(5000);
    expect(comm.invoice_currency).toBe("USD");
    expect(comm.invoice_ref).toBe("INV-2026-001");
    expect(comm.follow_up_date).toBe("2026-04-01");
    expect(comm.follow_up_done).toBe(false);
  });

  it("handles follow_up_done as true", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-01",
      follow_up_done: true,
    });
    expect(comm.follow_up_done).toBe(true);
  });
});

describe("listVendorCommunications", () => {
  it("lists communications for a company", () => {
    const co = createCompany({ name: "Vendor" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-02" });
    const comms = listVendorCommunications(co.id);
    expect(comms).toHaveLength(2);
  });

  it("returns empty for company with no communications", () => {
    const co = createCompany({ name: "Vendor" });
    expect(listVendorCommunications(co.id)).toEqual([]);
  });

  it("does not include communications from other companies", () => {
    const co1 = createCompany({ name: "Vendor A" });
    const co2 = createCompany({ name: "Vendor B" });
    logVendorCommunication({ company_id: co1.id, comm_date: "2026-01-01" });
    logVendorCommunication({ company_id: co2.id, comm_date: "2026-01-02" });
    const comms = listVendorCommunications(co1.id);
    expect(comms).toHaveLength(1);
    expect(comms[0]!.company_id).toBe(co1.id);
  });

  it("filters by type", () => {
    const co = createCompany({ name: "Vendor" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01", type: "email" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-02", type: "call" });
    const comms = listVendorCommunications(co.id, { type: "email" });
    expect(comms).toHaveLength(1);
    expect(comms[0]!.type).toBe("email");
  });

  it("filters by status", () => {
    const co = createCompany({ name: "Vendor" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01", status: "sent" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-02", status: "awaiting_response" });
    const comms = listVendorCommunications(co.id, { status: "sent" });
    expect(comms).toHaveLength(1);
    expect(comms[0]!.status).toBe("sent");
  });

  it("filters by direction", () => {
    const co = createCompany({ name: "Vendor" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01", direction: "outbound" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-02", direction: "inbound" });
    const comms = listVendorCommunications(co.id, { direction: "inbound" });
    expect(comms).toHaveLength(1);
    expect(comms[0]!.direction).toBe("inbound");
  });

  it("combines multiple filters", () => {
    const co = createCompany({ name: "Vendor" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01", type: "email", direction: "outbound" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-02", type: "email", direction: "inbound" });
    logVendorCommunication({ company_id: co.id, comm_date: "2026-01-03", type: "call", direction: "outbound" });
    const comms = listVendorCommunications(co.id, { type: "email", direction: "outbound" });
    expect(comms).toHaveLength(1);
  });
});

describe("updateVendorCommunication", () => {
  it("updates basic fields", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01", subject: "Old" });
    const updated = updateVendorCommunication(comm.id, { subject: "New", status: "resolved" });
    expect(updated.subject).toBe("New");
    expect(updated.status).toBe("resolved");
  });

  it("clears nullable fields", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-01",
      subject: "Test",
      body: "Body text",
      invoice_amount: 100,
    });
    const updated = updateVendorCommunication(comm.id, {
      subject: null,
      body: null,
      invoice_amount: null,
    });
    expect(updated.subject).toBeNull();
    expect(updated.body).toBeNull();
    expect(updated.invoice_amount).toBeNull();
  });

  it("updates follow_up_done", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01" });
    const updated = updateVendorCommunication(comm.id, { follow_up_done: true });
    expect(updated.follow_up_done).toBe(true);
  });

  it("returns unchanged record when no fields provided", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01", subject: "Test" });
    const updated = updateVendorCommunication(comm.id, {});
    expect(updated.subject).toBe("Test");
  });
});

describe("deleteVendorCommunication", () => {
  it("deletes a communication", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({ company_id: co.id, comm_date: "2026-01-01" });
    deleteVendorCommunication(comm.id);
    const comms = listVendorCommunications(co.id);
    expect(comms).toEqual([]);
  });

  it("does not throw for non-existent id", () => {
    expect(() => deleteVendorCommunication("non-existent")).not.toThrow();
  });
});

describe("listPendingFollowUps", () => {
  it("returns communications with past follow_up_date and follow_up_done = false", () => {
    const co = createCompany({ name: "Vendor" });
    logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-01",
      follow_up_date: "2020-01-01",
      follow_up_done: false,
    });
    logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-02",
      follow_up_date: "2099-12-31",
      follow_up_done: false,
    });
    logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-03",
      follow_up_date: "2020-01-01",
      follow_up_done: true,
    });
    const pending = listPendingFollowUps();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.follow_up_date).toBe("2020-01-01");
    expect(pending[0]!.follow_up_done).toBe(false);
  });

  it("returns empty when no pending follow-ups", () => {
    expect(listPendingFollowUps()).toEqual([]);
  });
});

describe("listMissingInvoices", () => {
  it("returns invoice_request comms with awaiting_response or no_response status", () => {
    const co = createCompany({ name: "Vendor" });
    logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-01",
      type: "invoice_request",
      status: "awaiting_response",
    });
    logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-02",
      type: "invoice_request",
      status: "no_response",
    });
    logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-03",
      type: "invoice_request",
      status: "resolved",
    });
    logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-04",
      type: "email",
      status: "awaiting_response",
    });
    const missing = listMissingInvoices();
    expect(missing).toHaveLength(2);
  });

  it("returns empty when no missing invoices", () => {
    expect(listMissingInvoices()).toEqual([]);
  });
});

describe("markFollowUpDone", () => {
  it("marks a follow-up as done", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-01",
      follow_up_date: "2026-02-01",
      follow_up_done: false,
    });
    const updated = markFollowUpDone(comm.id);
    expect(updated.follow_up_done).toBe(true);
  });

  it("is idempotent - marking already done follow-up stays done", () => {
    const co = createCompany({ name: "Vendor" });
    const comm = logVendorCommunication({
      company_id: co.id,
      comm_date: "2026-01-01",
      follow_up_done: true,
    });
    const updated = markFollowUpDone(comm.id);
    expect(updated.follow_up_done).toBe(true);
  });
});
