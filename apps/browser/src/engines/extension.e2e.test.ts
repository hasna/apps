import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type BrowserContext } from "playwright";
import { BrowserSDK } from "../sdk.js";
import { getText } from "../lib/extractor.js";
import { getTimeline } from "../db/timeline.js";
import { resetDatabase } from "../db/schema.js";

const RUN_E2E = process.env["BROWSER_E2E"] === "1";
const HEADLESS_E2E = process.env["BROWSER_E2E_HEADLESS"] === "1";

let tmpDir = "";

function extensionDistPath(): string {
  return join(import.meta.dir, "../../extension/dist");
}

async function run(command: string[], cwd = join(import.meta.dir, "../..")): Promise<void> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed with ${code}\n${stdout}\n${stderr}`);
  }
}

function reservePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  server.stop(true);
  if (typeof port !== "number") throw new Error("Bun did not allocate a port");
  return port;
}

async function waitFor(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForExtensionId(context: BrowserContext): Promise<string> {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  return new URL(worker.url()).host;
}

async function waitForConnected(serverUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await fetch(`${serverUrl}/api/extension/status`).then((res) => res.json()) as { connected?: boolean };
    if (status.connected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Extension did not connect");
}

beforeEach(() => {
  if (!RUN_E2E) return;
  tmpDir = mkdtempSync(join(tmpdir(), "browser-extension-e2e-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "local.db");
  process.env["BROWSER_DATA_DIR"] = join(tmpDir, "local-data");
  resetDatabase();
});

afterEach(() => {
  if (!RUN_E2E) return;
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("extension engine e2e", () => {
  it("runs one SDK action through the loaded Chrome extension path", async () => {
    if (!RUN_E2E) return;

    await run(["bun", "run", "build:extension"]);
    const extensionPath = extensionDistPath();
    expect(existsSync(join(extensionPath, "manifest.json"))).toBe(true);

    const browserPort = reservePort();
    const browserServerUrl = `http://127.0.0.1:${browserPort}`;
    const browserServer = Bun.spawn(["bun", "run", "src/server/index.ts"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        BROWSER_SERVER_PORT: String(browserPort),
        BROWSER_DB_PATH: join(tmpDir, "server.db"),
        BROWSER_DATA_DIR: join(tmpDir, "server-data"),
      },
    });

    const fixture = Bun.serve({
      port: 0,
      fetch() {
        return new Response(`<!doctype html><title>Extension Fixture</title><main><h1>Extension path works</h1><input id="name" /></main>`, {
          headers: { "Content-Type": "text/html" },
        });
      },
    });

    let context: BrowserContext | null = null;
    try {
      await waitFor(`${browserServerUrl}/health`);
      const pair = await fetch(`${browserServerUrl}/api/extension/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttl_ms: 60_000 }),
      }).then((res) => res.json()) as { code: string };

      context = await chromium.launchPersistentContext(join(tmpDir, "chrome-profile"), {
        headless: HEADLESS_E2E ? true : false,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });

      const extensionId = await waitForExtensionId(context);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.fill("#server-url", `ws://127.0.0.1:${browserPort}`);
      await popup.fill("#pair-code", pair.code);
      await popup.click("#pair");
      await waitForConnected(browserServerUrl);

      const sdk = new BrowserSDK();
      const handle = await sdk.open({
        engine: "extension",
        extensionServerUrl: browserServerUrl,
      });
      await sdk.navigate(handle, `http://127.0.0.1:${fixture.port}`);
      await sdk.fill(handle, "#name", "Ada", { selfHeal: false });

      const text = await getText(handle.page);
      expect(text).toContain("Extension path works");

      const timeline = getTimeline(handle.id, 20);
      expect(timeline.some((event) => event.event_type === "extension_job" && event.details.includes("\"engine\":\"extension\""))).toBe(true);
      await sdk.close(handle);
    } finally {
      await context?.close().catch(() => {});
      fixture.stop(true);
      browserServer.kill();
      await browserServer.exited.catch(() => {});
    }
  }, 60_000);
});
