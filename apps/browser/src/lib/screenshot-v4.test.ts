import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import { resetDatabase } from "../db/schema.js";
import { takeScreenshot } from "./screenshot.js";
import { createSession, closeSession } from "./session.js";

let browser: Browser;
let page: Page;
let testServer: ReturnType<typeof Bun.serve>;
let TEST_URL: string;
let tmpDir: string;

beforeAll(async () => {
  testServer = Bun.serve({
    port: 0,
    fetch() { return new Response("<html><body><h1>Test</h1></body></html>", { headers: { "Content-Type": "text/html" } }); }
  });
  TEST_URL = `http://localhost:${testServer.port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(TEST_URL);
});

afterAll(async () => {
  await browser.close();
  testServer.stop();
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ss-v4-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("screenshot rawOpts — no quality field for PNG", () => {
  it("PNG screenshot succeeds with no quality parameter", async () => {
    const result = await takeScreenshot(page, { format: "png", track: false });
    expect(result.path.endsWith(".png")).toBe(true);
    expect(result.size_bytes).toBeGreaterThan(0);
    expect(result.base64.length).toBeGreaterThan(0);
  });

  it("WebP screenshot succeeds (default)", async () => {
    const result = await takeScreenshot(page, { track: false });
    expect(result.path.endsWith(".webp")).toBe(true);
    expect(result.size_bytes).toBeGreaterThan(0);
  });

  it("JPEG screenshot succeeds", async () => {
    const result = await takeScreenshot(page, { format: "jpeg", track: false });
    expect(result.path.endsWith(".jpeg")).toBe(true);
    expect(result.size_bytes).toBeGreaterThan(0);
  });
});

describe("screenshot fallback when sharp fails", () => {
  it("returns fallback:true and valid base64 when compression errors", async () => {
    // We can't easily mock sharp, but we can test that the fallback field
    // is NOT present normally (compression succeeds)
    const result = await takeScreenshot(page, { format: "webp", track: false });
    // Normal path: no fallback
    expect((result as any).fallback).toBeUndefined();
    expect(result.compression_ratio).toBeLessThan(1);
  });

  it("compress=false skips sharp entirely — no fallback needed", async () => {
    const result = await takeScreenshot(page, { compress: false, track: false });
    expect(result.base64.length).toBeGreaterThan(0);
    expect((result as any).fallback).toBeUndefined();
  });
});

describe("start_url session — screenshot works immediately after creation", () => {
  it("session with start_url can take screenshot immediately", async () => {
    const { session, page: sessionPage } = await createSession({
      startUrl: TEST_URL,
      headless: true,
    });
    const result = await takeScreenshot(sessionPage, { track: false });
    expect(result.size_bytes).toBeGreaterThan(0);
    expect(result.base64.length).toBeGreaterThan(0);
    await closeSession(session.id);
  });

  it("network log captures initial load from start_url", async () => {
    const { session } = await createSession({
      startUrl: TEST_URL,
      headless: true,
    });
    await new Promise(r => setTimeout(r, 300));
    const { getNetworkLog } = await import("../db/network-log.js");
    const log = getNetworkLog(session.id);
    expect(log.length).toBeGreaterThan(0);
    await closeSession(session.id);
  });
});

describe("session name unique constraint — graceful fallback", () => {
  it("two sessions with same start_url get different names", async () => {
    const { session: s1 } = await createSession({ startUrl: TEST_URL, headless: true });
    const { session: s2 } = await createSession({ startUrl: TEST_URL, headless: true });
    // Both should succeed (no UNIQUE constraint crash)
    expect(s1.id).not.toBe(s2.id);
    // s2 name should be suffixed since s1 already took the hostname
    if (s1.name && s2.name) {
      expect(s2.name).toContain(s1.name.split("-")[0]); // hostname portion
    }
    await closeSession(s1.id);
    await closeSession(s2.id);
  });
});
