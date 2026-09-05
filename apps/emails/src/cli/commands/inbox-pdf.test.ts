// `emails inbox pdf <id>` through authenticated HTTP, for both retained command
// registrars. The API fixture owns an explicit in-memory adapter; the command
// receives only API configuration and must never fall back to that local data.
//
// The verb mirrors `emails inbox open`: resolveMailId (short-id prefix
// resolution) -> getMessage -> getMessageBody -> renderer -> writeFileSync, and
// it never marks the email read (no setRead call). The PDF contract asserted
// here is the file-level one: %PDF magic, %%EOF trailer, non-zero bytes, and a
// PDFDocument.load round-trip of the written file; --json emits
// {path, bytes, ok: true}.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { decodePDFRawStream } from "pdf-lib/cjs/core/streams/decode.js";
import { closeDatabase, getDatabase, type Database } from "../../db/database.js";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV,
  EMAILS_API_URL_SETTINGS, RETIRED_EMAILS_SELECTOR_SETTINGS } from "../../lib/client-settings.js";
import { CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, EMAILS_CLIENT_ENV_SECRET_ENV } from "../../lib/client-env.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";
import { registerInboxCommands } from "./inbox.local.js";
import { registerInboxCommands as registerRemoteInboxCommands } from "./inbox.remote.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let db: Database;
let originalExitCode: typeof process.exitCode;
let fixtureRoot: string;
let stateRoots: string[];
let api: V1StoreApi;
let messageReads: number;
let statusWrites: number;

function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}

function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

async function runInboxCommand(args: string[], register = registerInboxCommands): Promise<{ data: unknown; out: string }> {
  const program = new Command();
  program.exitOverride();
  let data: unknown;
  const out: string[] = [];
  const originalExit = process.exit;
  process.exit = ((code?: number) => { throw new Error(`process.exit:${code ?? 0}`); }) as typeof process.exit;
  try {
    register(program, (d, formatted) => {
      data = d;
      out.push(String(formatted ?? ""));
    });
    await program.parseAsync(["node", "emails", ...args]);
    return { data, out: out.join("\n") };
  } finally {
    process.exit = originalExit;
  }
}

// handleError exits via process.exit(1); override exit to throw so the test can
// capture both the exit code and the stderr the command printed.
async function runInboxCommandExpectingExit(args: string[], register = registerInboxCommands) {
  const originalExit = process.exit;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = ((message?: unknown) => { errors.push(String(message ?? "")); }) as typeof console.error;
  process.exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as typeof process.exit;
  try {
    await runInboxCommand(args, register);
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
  originalExitCode = process.exitCode;
  fixtureRoot = mkdtempSync(join(tmpdir(), "emails-pdf-state-"));
  stateRoots = Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app" }).map(([key, name]) => {
    const path = join(fixtureRoot, name);
    mkdirSync(path);
    process.env[key] = path;
    return path;
  });
  for (const key of [...CLIENT_DATABASE_SETTINGS, ...RETIRED_EMAILS_SELECTOR_SETTINGS,
    ...EMAILS_API_URL_SETTINGS, ...CLIENT_ENV_CREDENTIAL_SELECTION_KEYS, EMAILS_CLIENT_ENV_SECRET_ENV,
    "EMAILS_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME"]) delete process.env[key];
  closeDatabase();
  db = getDatabase(":memory:");
  const store = createSqliteEmailStore({ database: db });
  messageReads = 0;
  statusWrites = 0;
  api = startV1StoreApi({ store: { ...store, messages: { ...store.messages,
    async getMessage(id) { messageReads++; return store.messages.getMessage(id); },
    async updateMessageStatus(id, patch) { statusWrites++; return store.messages.updateMessageStatus(id, patch); },
  } } });
  process.env[EMAILS_API_URL_ENV] = api.baseUrl;
  process.env[EMAILS_API_KEY_ENV] = api.apiKey;
  resetMailDataSource();
  resetSelfHostedConfigCache();
});

afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
  } finally {
    api.stop();
    closeDatabase();
    resetMailDataSource();
    resetSelfHostedConfigCache();
    restoreInheritedProcessEnv();
    process.exitCode = originalExitCode;
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

/** One inbound message; the id is long enough to exercise prefix resolution. */
function seedInboundEmail(): string {
  const id = "pdfabc1234567890defghijklmnopq";
  // The real PG wire contract uses RFC3339, not SQLite datetime() formatting.
  const timestamp = new Date().toISOString();
  db.run(
    `INSERT INTO inbound_emails (id, from_address, to_addresses, cc_addresses, subject, text_body, html_body, is_read, received_at, created_at, is_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`,
    id,
    "sender@elsewhere.test",
    '["me@example.test"]',
    "[]",
    "PDF fixture",
    "Fixture text body for the pdf verb.",
    null,
    timestamp,
    timestamp,
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

// Same-build decoder as tui/pdf.test.ts. Assert the real written page content,
// not just a valid container that could hide a blank or unrelated PDF.
async function drawnPdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const text: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents() as unknown as {
      array?: unknown[]; context?: { lookup(ref: unknown): unknown };
    } | undefined;
    for (const ref of contents?.array ?? []) {
      const stream = contents?.context?.lookup(ref) as { contents?: Uint8Array } | undefined;
      if (!stream?.contents) continue;
      const decoded = decodePDFRawStream(stream as Parameters<typeof decodePDFRawStream>[0]);
      for (const match of new TextDecoder().decode(decoded.getBytes()).matchAll(/<([0-9a-fA-F]{2,})>\s*Tj/g)) {
        text.push(Buffer.from(match[1]!, "hex").toString("utf8"));
      }
    }
  }
  return text.join("\n");
}

describe("inbox PDF fixture exit guard", () => {
  it("turns an unexpected nonzero process exit into a rejected test operation and restores the exit hook", async () => {
    const originalExit = process.exit;
    await expect(runInboxCommand(["exit-fixture"], (program) => {
      program.command("exit-fixture").action(() => process.exit(92));
    })).rejects.toThrow("process.exit:92");
    expect(process.exit).toBe(originalExit);
  });
});

for (const [arm, register] of [["local registrar", registerInboxCommands], ["canonical registrar", registerRemoteInboxCommands]] as const) {
describe(`inbox pdf (${arm}, authenticated API)`, () => {
  it("writes a %PDF file at --out and emits {path, bytes, ok: true} under --json", async () => {
    const id = seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "invoice.pdf");
      const result = await runInboxCommand(["inbox", "pdf", id, "--out", outPath, "--json"], register);
      const payload = result.data as { path: string; bytes: number; ok: boolean };
      expect(payload.ok).toBe(true);
      expect(payload.path).toBe(outPath);
      const bytes = readPdf(outPath);
      expect(bytes.byteLength).toBe(payload.bytes);
      assertPdfContract(bytes);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      const text = await drawnPdfText(bytes);
      expect(text).toContain("PDF fixture");
      expect(text).toContain("Fixture text body for the pdf verb.");
      expect(messageReads).toBeGreaterThan(0);
      expect(api.requestCount()).toBeGreaterThan(0);
      expect(statusWrites).toBe(0);
      expect(JSON.stringify(result)).not.toContain(api.apiKey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a short-id prefix exactly like read/open", async () => {
    const id = seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "prefixed.pdf");
      const result = await runInboxCommand(["inbox", "pdf", id.slice(0, 8), "--out", outPath], register);
      assertPdfContract(readPdf(outPath));
      expect(result.out).toContain(outPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on an unknown id with the same error contract as read", async () => {
    const pdfResult = await runInboxCommandExpectingExit(["inbox", "pdf", "nosuchid12345"], register);
    const readResult = await runInboxCommandExpectingExit(["inbox", "read", "nosuchid12345"], register);
    expect(pdfResult.error).toBe("process.exit:1");
    expect(readResult.error).toBe("process.exit:1");
    expect(pdfResult.stderr).toBe(readResult.stderr);
    expect(pdfResult.stderr).toContain("nosuchid12345");
    expect(pdfResult.stderr).not.toContain(api.apiKey);
  });

  it("never marks the email read (mirrors `open`, not `read`)", async () => {
    const id = seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "unread.pdf");
      await runInboxCommand(["inbox", "pdf", id, "--out", outPath], register);
      const row = db.query("SELECT is_read FROM inbound_emails WHERE id = ?").get(id) as { is_read: number };
      expect(row.is_read).toBe(0);
      expect(messageReads).toBeGreaterThan(0);
      expect(statusWrites).toBe(0);
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
      await runInboxCommand(["inbox", "pdf", id, "--out", outPath], register);
      assertPdfContract(readPdf(outPath));
      expect((await PDFDocument.load(readPdf(outPath))).getPageCount()).toBeGreaterThanOrEqual(1);
      expect(await drawnPdfText(readPdf(outPath))).toContain("Html only body");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses authentication without producing a PDF or falling back to the populated local fixture", async () => {
    const id = seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-denied-"));
    try {
      const outPath = join(dir, "denied.pdf");
      process.env[EMAILS_API_KEY_ENV] = "fixture-denied-pdf-key";
      resetMailDataSource();
      resetSelfHostedConfigCache();
      const result = await runInboxCommandExpectingExit(["inbox", "pdf", id, "--out", outPath], register);
      expect(result.error).toBe("process.exit:1");
      expect(result.stderr).not.toContain("fixture-denied-pdf-key");
      expect(existsSync(outPath)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
      expect(api.requestCount()).toBeGreaterThan(0);
      expect(messageReads).toBe(0);
      expect(statusWrites).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
}
