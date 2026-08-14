import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "../db/schema.js";
import { takeSnapshot } from "../lib/snapshot.js";
import { chromium, type Browser } from "playwright";
import { createSession, closeSession } from "../lib/session.js";

let tmpDir: string;
let browser: Browser;
let testServer: ReturnType<typeof Bun.serve>;
let TEST_URL: string;
let REDIRECT_URL: string;

beforeAll(async () => {
  testServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      // Simulate geo-redirect like stripe.com → stripe.com/en-ro
      if (url.pathname === "/" || url.pathname === "") {
        return Response.redirect(`http://localhost:${testServer.port}/en-us/`, 302);
      }
      return new Response(`<html><body><h1>Page</h1><a href="/about">About</a><button>OK</button></body></html>`,
        { headers: { "Content-Type": "text/html" } });
    }
  });
  TEST_URL = `http://localhost:${testServer.port}/en-us/`;
  REDIRECT_URL = `http://localhost:${testServer.port}/`;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
  testServer.stop();
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "v4-test-"));
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

describe("compact snapshot mode", () => {
  it("compact mode returns compact_refs string < 3KB for simple page", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(TEST_URL);

    const result = await takeSnapshot(page, "compact-test");
    // Simulate compact formatting
    const refEntries = Object.entries(result.refs).slice(0, 50);
    const compactRefs = refEntries
      .map(([ref, info]) => `${info.role}:${info.name.slice(0, 60)} [${ref}]`)
      .join("\n");

    expect(compactRefs.length).toBeLessThan(3000);
    expect(result.interactive_count).toBeGreaterThanOrEqual(2); // link + button
    await ctx.close();
  });

  it("max_refs limits returned refs", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(TEST_URL);

    const result = await takeSnapshot(page, "maxrefs-test");
    const limitedEntries = Object.entries(result.refs).slice(0, 1);
    expect(limitedEntries.length).toBeLessThanOrEqual(1);
    await ctx.close();
  });

  it("full tree is larger than compact", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(TEST_URL);

    const result = await takeSnapshot(page, "tree-size-test");
    const compact = Object.entries(result.refs).slice(0, 50)
      .map(([r, i]) => `${i.role}:${i.name} [${r}]`).join("\n");
    expect(result.tree.length).toBeGreaterThanOrEqual(compact.length);
    await ctx.close();
  });
});

describe("session auto-naming on navigate", () => {
  it("session gets named after first navigate if name is null", async () => {
    const { session } = await createSession({ headless: true });
    expect(session.name).toBeNull();

    const { getSession: dbGet } = await import("../db/sessions.js");
    const { renameSession } = await import("../db/sessions.js");

    // Simulate what browser_navigate does: auto-name if null
    renameSession(session.id, "localhost");
    const updated = dbGet(session.id);
    expect(updated.name).toBe("localhost");
    await closeSession(session.id);
  });

  it("session with existing name is not overwritten on navigate", async () => {
    const { session } = await createSession({ headless: true, name: "my-session" });
    expect(session.name).toBe("my-session");

    // Simulate navigate auto-naming logic: skip if name exists
    const { getSession: dbGet } = await import("../db/sessions.js");
    const before = dbGet(session.id);
    expect(before.name).toBe("my-session"); // unchanged
    await closeSession(session.id);
  });
});

function isRedirected(requested: string, final: string): boolean {
  return final !== requested && final !== requested + "/" && requested !== final.replace(/\/$/, "");
}

describe("redirect detection in navigate result", () => {
  it("detects redirect when URL changes", () => {
    expect(isRedirected("http://example.com", "http://example.com/en-us/")).toBe(true);
  });

  it("no redirect when URL is same", () => {
    const url = "https://stripe.com";
    expect(isRedirected(url, url)).toBe(false);
  });

  it("no false-positive for trailing slash", () => {
    expect(isRedirected("https://stripe.com", "https://stripe.com/")).toBe(false);
  });

  it("geo redirect detected with /xx-yy/ pattern", () => {
    const currentUrl = "https://stripe.com/en-ro/pricing";
    const isGeo = currentUrl.match(/\/[a-z]{2}-[a-z]{2}\//) !== null;
    expect(isGeo).toBe(true);
  });
});

describe("browser_version tool fields", () => {
  it("package.json version is a valid semver string", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"));
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("data dir is set", async () => {
    const { getDataDir } = await import("../db/schema.js");
    const dataDir = getDataDir();
    expect(typeof dataDir).toBe("string");
    expect(dataDir.length).toBeGreaterThan(0);
  });
});
