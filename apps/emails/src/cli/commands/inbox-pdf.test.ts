// Render real API message fixtures and verify exported PDF bytes without a local mail store.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import { registerInboxCommands } from "./inbox.remote.js";
let api: V1Stub;

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

beforeEach(async () => {
  api = await startV1Stub({ openapi: true });
  api.applyEnv();
  resetMailDataSource();
});
afterEach(() => { api.clearEnv(); api.stop(); resetMailDataSource(); });
async function seedInboundEmail(htmlOnly = false): Promise<string> {
  const id = "pdfabc1234567890defghijklmnopq";
  await api.seed({ messages: [{ id, direction: "inbound", from_addr: "sender@elsewhere.test",
    to_addrs: ["me@example.test"], cc_addrs: [], subject: "PDF fixture",
    body_text: htmlOnly ? null : "Fixture text body for the pdf verb.",
    body_html: htmlOnly ? "<p>Html only body</p>" : null,
    is_read: false, received_at: "2026-09-07T00:00:00Z", created_at: "2026-09-07T00:00:00Z" }] });
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

describe("inbox pdf (authenticated API)", () => {
  it("writes a %PDF file at --out and emits {path, bytes, ok: true} under --json", async () => {
    const id = await seedInboundEmail();
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
    const id = await seedInboundEmail();
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
    const id = await seedInboundEmail();
    const dir = mkdtempSync(join(tmpdir(), "emails-pdf-"));
    try {
      const outPath = join(dir, "unread.pdf");
      await runInboxCommand(["inbox", "pdf", id, "--out", outPath]);
      const row = (await api.list("messages")).find((message) => message.id === id);
      expect(row?.is_read).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders an html-only message (fallback path) to a valid PDF", async () => {
    const id = await seedInboundEmail(true);
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
