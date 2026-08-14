import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import {
  createSigningSession,
  getSessionById,
  getSessionByToken,
  listSessionsForDocument,
  updateSessionStatus,
} from "./signing-sessions.js";
import { createDocument } from "./documents.js";
import { NotFoundError } from "../types/index.js";

beforeEach(() => { closeDatabase(); });

function makeDoc() {
  return createDocument({ name: "Doc", file_path: "/tmp/f.pdf", file_name: "f.pdf", slug: `doc-${Date.now()}` });
}

describe("signing-sessions", () => {
  test("creates a session with unique token", () => {
    const doc = makeDoc();
    const session = createSigningSession({ document_id: doc.id });
    expect(session.id).toMatch(/^ses-/);
    expect(session.token).toBeTruthy();
    expect(session.status).toBe("pending");
    expect(session.source).toBe("local");
  });

  test("creates session with signer info", () => {
    const doc = makeDoc();
    const session = createSigningSession({
      document_id: doc.id,
      signer_name: "John",
      signer_email: "john@example.com",
    });
    expect(session.signer_name).toBe("John");
    expect(session.signer_email).toBe("john@example.com");
  });

  test("gets session by ID", () => {
    const doc = makeDoc();
    const s = createSigningSession({ document_id: doc.id });
    expect(getSessionById(s.id).id).toBe(s.id);
  });

  test("throws NotFoundError for missing session", () => {
    expect(() => getSessionById("ses-missing")).toThrow(NotFoundError);
  });

  test("gets session by token", () => {
    const doc = makeDoc();
    const s = createSigningSession({ document_id: doc.id });
    expect(getSessionByToken(s.token).id).toBe(s.id);
  });

  test("lists sessions for document", () => {
    const doc = makeDoc();
    createSigningSession({ document_id: doc.id });
    createSigningSession({ document_id: doc.id });
    expect(listSessionsForDocument(doc.id).length).toBe(2);
  });

  test("updates session status to completed", () => {
    const doc = makeDoc();
    const s = createSigningSession({ document_id: doc.id });
    const updated = updateSessionStatus(s.id, "completed");
    expect(updated.status).toBe("completed");
  });

  test("stores metadata as JSON", () => {
    const doc = makeDoc();
    const s = createSigningSession({
      document_id: doc.id,
      metadata: { foo: "bar", num: 42 },
    });
    expect(s.metadata?.["foo"]).toBe("bar");
  });
});
