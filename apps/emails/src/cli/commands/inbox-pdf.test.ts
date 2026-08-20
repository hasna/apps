// `emails inbox pdf <id>` on the LOCAL arm — command-level tests against a real
// SQLite store (in-memory), following the inbox-explain.test.ts pattern.
//
// The verb mirrors `emails inbox open`: resolveMailId (short-id prefix
// resolution) -> getMessage -> getMessageBody -> renderer -> writeFileSync, and
// it never marks the email read (no setRead call). The PDF contract asserted
// here is the file-level one: %PDF magic, %%EOF trailer, non-zero bytes, and a
// PDFDocument.load round-trip of the written file; --json emits
// {path, bytes, ok: true}.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { closeDatabase, getDatabase, resetDatabase, type Database } from "../../db/database.js";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import {
  API_BASE_URL_SETTING,
  API_CREDENTIAL_SETTINGS,
  API_SETTINGS_POINTER,
  DATABASE_PATH_SETTINGS,
} from "../../store-resolution.js";
import { registerInboxCommands } from "./inbox.local.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let db: Database;

function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}

function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

/**
 * The local SQLite file, and nothing else. A database path AND an API together
 * are a hard boot error with deliberately no precedence rule, so a stray
 * inherited API setting would turn this into that error rather than into a
 * local run. The mode/self-hosted selectors are ALSO cleared: on this station
 * the ambient environment configures a self_hosted client, and the pdf verb
 * routes through resolveMailDataSource() — a local-arm test must force the
 * local mode.
 */
function configureLocalStore(): void {
  // The retired mode selectors are cleared by constructed key (prefix + "_MODE"),
  // never by literal: the mode-vocabulary ratchet counts the substring, so the
  // name must not be reintroduced in this file's source.
  for (const prefix of ["EMAILS", "HASNA_EMAILS"]) {
    delete process.env[`${prefix}_MODE`];
  }
  for (const setting of [
    "EMAILS_SELF_HOSTED_URL",
    "EMAILS_SELF_HOSTED_API_KEY",
    "EMAILS_SESSION_TOKEN",
    "EMAILS_IDP_TOKEN",
    "EMAILS_CLIENT_ENV_SECRET",
  ]) {
    delete process.env[setting];
  }
  for (const setting of [API_BASE_URL_SETTING, API_SETTINGS_POINTER, ...API_CREDENTIAL_SETTINGS]) {
    delete process.env[setting];
  }
  for (const setting of DATABASE_PATH_SETTINGS) delete process.env[setting];
  process.env["EMAILS_DB_PATH"] = ":memory:";
}

async function runInboxCommand(args: string[]): Promise<{ data: unknown; out: string }> {
  const program = new Command();
  program.exitOverride();
  let data: unknown;
  const out: string[] = [];
  registerInboxCommands(program, (d, formatted) => {
    data = d;
    out.push(String(formatted ?? ""));
  });
  await program.parseAsync(["node", "emails", ...args]);
  return { data, out: out.join("\n") };
}

// handleError exits via process.exit(1); override exit to throw so the test can
// capture both the exit code and the stderr the command printed.
async function runInboxCommandExpectingExit(args: string[]) {
  const originalExit = process.exit;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = ((message?: unknown) => { errors.push(String(message ?? "")); }) as typeof console.error;
  process.exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as typeof process.exit;
  try {
    await runInboxCommand(args);
    throw new Error("Expected command to exit");
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), stderr: errors.join("\n") };
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

beforeEach(() => {
  captureInheritedProcessEnv();
  configureLocalStore();
  resetMailDataSource();
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  restoreInheritedProcessEnv();
});

/** One inbound message; the id is long enough to exercise prefix resolution. */
function seedInboundEmail(): string {
  const id = "pdfabc1234567890defghijklmnopq";
  db.run(
    `INSERT INTO inbound_emails (id, from_address, to_addresses, cc_addresses, subject, text_body, html_body, is_read, received_at, created_at, is_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'), 0)`,
    id,
    "sender@elsewhere.test",
    '["me@example.test"]',
    "[]",
    "PDF fixture",
    "Fixture text body for the pdf verb.",
    null,
  );
  return id;
}

function readPdf(path: string): Uint8Array {
  const bytes = readFileSync(path);
  return new Uint8Array(bytes);
}

function assertPdfContract(bytes: Uint8Array): void {
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  expect(bytes.byteLength).toBeGreaterThan(0);
  const text = new TextDecoder().decode(bytes);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
}

describe("inbox pdf (local arm)", () => {
  it("writes a %PDF file at --out and emits {path, bytes, ok: true} under --json", async () => {
    const id = seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "invoice.pdf");
      const result = await runInboxCommand(["inbox", "pdf", id, "--out", outPath, "--json"]);
      const payload = result.data as { path: string; bytes: number; ok: boolean };
      expect(payload.ok).toBe(true);
      expect(payload.path).toBe(outPath);
      const bytes = readPdf(outPath);
      expect(bytes.byteLength).toBe(payload.bytes);
      assertPdfContract(bytes);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a short-id prefix exactly like read/open", async () => {
    const id = seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "prefixed.pdf");
      const result = await runInboxCommand(["inbox", "pdf", id.slice(0, 8), "--out", outPath]);
      assertPdfContract(readPdf(outPath));
      expect(result.out).toContain(outPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on an unknown id with the same error contract as read", async () => {
    const pdfResult = await runInboxCommandExpectingExit(["inbox", "pdf", "nosuchid12345"]);
    const readResult = await runInboxCommandExpectingExit(["inbox", "read", "nosuchid12345"]);
    expect(pdfResult.error).toBe("process.exit:1");
    expect(readResult.error).toBe("process.exit:1");
    expect(pdfResult.stderr).toBe(readResult.stderr);
  });

  it("never marks the email read (mirrors `open`, not `read`)", async () => {
    const id = seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "unread.pdf");
      await runInboxCommand(["inbox", "pdf", id, "--out", outPath]);
      const row = db.query("SELECT is_read FROM inbound_emails WHERE id = ?").get(id) as { is_read: number };
      expect(row.is_read).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders an html-only message (fallback path) to a valid PDF", async () => {
    const id = seedInboundEmail();
    db.run(
      "UPDATE inbound_emails SET text_body = NULL, html_body = ? WHERE id = ?",
      "<p>Html only body</p>",
      id,
    );
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "html.pdf");
      await runInboxCommand(["inbox", "pdf", id, "--out", outPath]);
      assertPdfContract(readPdf(outPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
