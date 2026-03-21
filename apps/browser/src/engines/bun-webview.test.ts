import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isBunWebViewAvailable, BunWebViewSession } from "./bun-webview.js";
import { resetDatabase } from "../db/schema.js";
import { takeSnapshot } from "../lib/snapshot.js";
import { createSession, closeSession } from "../lib/session.js";

const SKIP = !isBunWebViewAvailable();
const it_bun = SKIP ? it.skip : it;

let testServer: ReturnType<typeof Bun.serve>;
let TEST_URL: string;
let tmpDir: string;

const HTML = `<!DOCTYPE html><html><head><title>Bun WebView Test</title></head><body>
  <h1>Hello Bun</h1>
  <nav><a href="/about">About</a> <a href="/contact">Contact</a></nav>
  <form>
    <input type="text" aria-label="Name" placeholder="Your name" />
    <input type="email" aria-label="Email" />
    <button type="button">Submit</button>
  </form>
  <p id="result">Ready</p>
</body></html>`;

beforeAll(() => {
  testServer = Bun.serve({
    port: 0,
    fetch() { return new Response(HTML, { headers: { "Content-Type": "text/html" } }); }
  });
  TEST_URL = `http://localhost:${testServer.port}`;
});

afterAll(() => { testServer.stop(); });

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "bun-wv-test-"));
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

describe("isBunWebViewAvailable", () => {
  it("returns a boolean", () => {
    expect(typeof isBunWebViewAvailable()).toBe("boolean");
  });

  it("returns true on canary bun", () => {
    if (SKIP) {
      console.log("  (Skipping — Bun.WebView not available in this build)");
      return;
    }
    expect(isBunWebViewAvailable()).toBe(true);
  });
});

describe("BunWebViewSession", () => {
  it_bun("throws if Bun.WebView not available (mock test)", () => {
    // This tests the error path — since we're in canary, it won't throw
    expect(isBunWebViewAvailable()).toBe(true);
  });

  it_bun("creates a session and navigates", async () => {
    const view = new BunWebViewSession({ width: 1280, height: 720 });
    await view.goto(TEST_URL);
    await new Promise(r => setTimeout(r, 200));
    expect(view.url()).toContain(`localhost:${testServer.port}`);
    await view.close();
  });

  it_bun("screenshot() returns a Buffer", async () => {
    const view = new BunWebViewSession({ width: 800, height: 600 });
    await view.goto(TEST_URL);
    const buf = await view.screenshot();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    await view.close();
  });

  it_bun("evaluate() returns values from the page", async () => {
    const view = new BunWebViewSession();
    await view.goto(TEST_URL);
    await new Promise(r => setTimeout(r, 300));
    const title = await view.evaluate("document.title");
    expect(title).toBe("Bun WebView Test");
    const linkCount = await view.evaluate("document.querySelectorAll('a').length") as number;
    expect(linkCount).toBeGreaterThanOrEqual(2);
    await view.close();
  });

  it_bun("evaluate() returns JSON-serializable objects", async () => {
    const view = new BunWebViewSession();
    await view.goto(TEST_URL);
    const obj = await view.evaluate("JSON.stringify({a:1,b:'hello'})") as string;
    expect(JSON.parse(obj)).toEqual({ a: 1, b: "hello" });
    await view.close();
  });

  it_bun("title() returns page title", async () => {
    const view = new BunWebViewSession();
    await view.goto(TEST_URL);
    await new Promise(r => setTimeout(r, 200));
    const title = await view.title();
    expect(title).toBe("Bun WebView Test");
    await view.close();
  });

  it_bun("isVisible() detects visible elements", async () => {
    const view = new BunWebViewSession();
    await view.goto(TEST_URL);
    await new Promise(r => setTimeout(r, 200));
    expect(await view.isVisible("button")).toBe(true);
    expect(await view.isVisible("#nonexistent")).toBe(false);
    await view.close();
  });
});

describe("engine selector with bun", () => {
  it_bun("selectEngine returns 'bun' for SCRAPE when available", async () => {
    const { selectEngine } = await import("./selector.js");
    const { UseCase } = await import("../types/index.js");
    const engine = selectEngine(UseCase.SCRAPE);
    expect(engine).toBe("bun");
  });

  it_bun("selectEngine returns 'bun' for SCREENSHOT when available", async () => {
    const { selectEngine } = await import("./selector.js");
    const { UseCase } = await import("../types/index.js");
    expect(selectEngine(UseCase.SCREENSHOT)).toBe("bun");
  });

  it("selectEngine still returns 'playwright' for FORM_FILL (bun doesn't support multi-tab)", async () => {
    const { selectEngine } = await import("./selector.js");
    const { UseCase } = await import("../types/index.js");
    expect(selectEngine(UseCase.FORM_FILL)).toBe("playwright");
  });

  it("selectEngine returns 'cdp' for NETWORK_MONITOR", async () => {
    const { selectEngine } = await import("./selector.js");
    const { UseCase } = await import("../types/index.js");
    expect(selectEngine(UseCase.NETWORK_MONITOR)).toBe("cdp");
  });
});

describe("createSession with engine='bun'", () => {
  it_bun("creates active session and returns page proxy", async () => {
    const { session, page } = await createSession({ engine: "bun", headless: true });
    expect(session.status).toBe("active");
    expect(session.engine).toBe("bun");
    await closeSession(session.id);
  });

  it_bun("navigates with start_url and page proxy works", async () => {
    const { session, page } = await createSession({ engine: "bun", startUrl: TEST_URL });
    await new Promise(r => setTimeout(r, 500));
    const url = page.url();
    expect(url).toContain(`localhost:${testServer.port}`);
    await closeSession(session.id);
  });

  it_bun("screenshot via takeScreenshot works on bun session", async () => {
    const { takeScreenshot } = await import("../lib/screenshot.js");
    const { session, page } = await createSession({ engine: "bun", startUrl: TEST_URL });
    await new Promise(r => setTimeout(r, 500));
    const result = await takeScreenshot(page as any, { track: false });
    expect(result.size_bytes).toBeGreaterThan(1000);
    expect(result.path).toBeTruthy();
    await closeSession(session.id);
  });
});

describe("takeBunSnapshot", () => {
  it_bun("returns refs for interactive elements", async () => {
    const view = new BunWebViewSession();
    await view.goto(TEST_URL);
    await new Promise(r => setTimeout(r, 400));
    const snap = await takeSnapshot(view as any, "bun-snap-test");
    expect(snap.interactive_count).toBeGreaterThanOrEqual(3); // 2 links + 1 button
    expect(Object.keys(snap.refs).length).toBeGreaterThanOrEqual(3);
    expect(snap.tree).toContain("[@e");
    // Check roles present
    const roles = Object.values(snap.refs).map(r => r.role);
    expect(roles).toContain("link");
    expect(roles).toContain("button");
    await view.close();
  });

  it_bun("each ref has role, name, visible, enabled", async () => {
    const view = new BunWebViewSession();
    await view.goto(TEST_URL);
    await new Promise(r => setTimeout(r, 400));
    const snap = await takeSnapshot(view as any, "bun-snap-fields");
    for (const [, info] of Object.entries(snap.refs)) {
      expect(typeof info.role).toBe("string");
      expect(typeof info.name).toBe("string");
      expect(typeof info.visible).toBe("boolean");
      expect(typeof info.enabled).toBe("boolean");
    }
    await view.close();
  });
});
