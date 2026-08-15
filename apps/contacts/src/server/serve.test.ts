import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContact, deleteContact } from "../db/contacts.js";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createContactsRequestHandler } from "./serve.js";

const originalDbPath = process.env["CONTACTS_DB_PATH"];
const originalToken = process.env["HASNA_CONTACTS_API_TOKENS"];
const originalSensitive = process.env["HASNA_CONTACTS_ALLOW_SENSITIVE_SYNC"];
const originalAllowUnauthenticatedLoopback = process.env["CONTACTS_ALLOW_UNAUTHENTICATED_LOOPBACK"];

let tmpDir: string;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://contacts.example${path}`, {
    ...init,
    headers: {
      host: "contacts.example",
      ...(init?.headers ?? {}),
    },
  });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-serve-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "contacts.db");
  process.env["HASNA_CONTACTS_API_TOKENS"] = [
    "read=contacts:read stats:read dashboard:read images:read documents:read mcp:access",
    "export=contacts:export",
    "full=contacts:export contacts:export:full",
    "write=contacts:read contacts:write contacts:import images:write tags:write companies:write",
  ].join(",");
  delete process.env["HASNA_CONTACTS_ALLOW_SENSITIVE_SYNC"];
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  restore("CONTACTS_DB_PATH", originalDbPath);
  restore("HASNA_CONTACTS_API_TOKENS", originalToken);
  restore("HASNA_CONTACTS_ALLOW_SENSITIVE_SYNC", originalSensitive);
  restore("CONTACTS_ALLOW_UNAUTHENTICATED_LOOPBACK", originalAllowUnauthenticatedLoopback);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("contacts serve auth and PII controls", () => {
  test("rejects shared-host API and dashboard requests without a token", async () => {
    const handler = createContactsRequestHandler();

    const api = await handler(request("/api/contacts"));
    expect(api.status).toBe(401);

    const dashboard = await handler(request("/"));
    expect(dashboard.status).toBe(401);
  });

  test("does not trust spoofed Host localhost for unauthenticated shared requests", async () => {
    delete process.env["HASNA_CONTACTS_API_TOKENS"];
    process.env["CONTACTS_ALLOW_UNAUTHENTICATED_LOOPBACK"] = "1";
    const handler = createContactsRequestHandler();

    const res = await handler(request("/api/contacts", {
      headers: { host: "localhost" },
    }));

    expect(res.status).toBe(401);
  });

  test("allows explicit unauthenticated loopback only with trusted bind context", async () => {
    delete process.env["HASNA_CONTACTS_API_TOKENS"];
    process.env["CONTACTS_ALLOW_UNAUTHENTICATED_LOOPBACK"] = "1";
    const handler = createContactsRequestHandler({ trustedLoopbackBind: true });

    const res = await handler(request("/api/contacts", {
      headers: { host: "contacts.example" },
    }));

    expect(res.status).toBe(200);
  });

  test("enforces dedicated export scopes and redacts PII by default", async () => {
    createContact({
      display_name: "Ada Lovelace",
      notes: "private context",
      birthday: "1815-12-10",
      emails: [{ address: "ada@example.com", type: "work", is_primary: true }],
      phones: [{ number: "+15551234567", type: "mobile", is_primary: true }],
      addresses: [{ street: "1 Secret Way", city: "London", type: "physical" }],
      sensitivity: "normal",
    });
    const handler = createContactsRequestHandler();

    const redacted = await handler(request("/api/export?format=json", {
      headers: { authorization: "Bearer export" },
    }));
    expect(redacted.status).toBe(200);
    const body = await redacted.json() as Array<Record<string, unknown>>;
    expect(body[0]?.["emails"]).toEqual([]);
    expect(body[0]?.["phones"]).toEqual([]);
    expect(body[0]?.["addresses"]).toEqual([]);
    expect(body[0]?.["notes"]).toBe("[redacted]");
    expect(redacted.headers.get("cache-control")).toBe("private, no-store");

    const denied = await handler(request("/api/export?format=json&include_sensitive=1", {
      headers: { authorization: "Bearer export" },
    }));
    expect(denied.status).toBe(403);

    const full = await handler(request("/api/export?format=json&include_sensitive=1", {
      headers: { authorization: "Bearer full" },
    }));
    expect(full.status).toBe(200);
    const fullBody = await full.json() as Array<Record<string, unknown>>;
    expect(fullBody[0]?.["emails"]).toEqual(expect.arrayContaining([expect.objectContaining({ address: "ada@example.com" })]));
  });

  test("rejects document paths outside the managed document directory", async () => {
    const db = getDatabase();
    const contact = createContact({ display_name: "Document Owner" });
    const outside = join(tmpDir, "outside.txt");
    writeFileSync(outside, "leak");
    db.run(
      `INSERT INTO contact_documents (id, contact_id, doc_type, label, encrypted_value, iv, encrypted_file_path, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["doc-outside", contact.id, "other", "outside", "cipher", "iv", outside, "{}", new Date().toISOString(), new Date().toISOString()],
    );

    const res = await createContactsRequestHandler()(request("/api/documents/doc-outside/file", {
      headers: { authorization: "Bearer read" },
    }));

    expect(res.status).toBe(404);
  });

  test("records tombstones for deletes", () => {
    const contact = createContact({ display_name: "Delete Me" });
    deleteContact(contact.id);

    const tombstone = getDatabase()
      .query("SELECT table_name, row_id, reason FROM _contacts_tombstones WHERE table_name = ? AND row_id = ?")
      .get("contacts", contact.id) as { table_name: string; row_id: string; reason: string } | null;

    expect(tombstone).toEqual({
      table_name: "contacts",
      row_id: contact.id,
      reason: "contact.deleted",
    });
  });
});
