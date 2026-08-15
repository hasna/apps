/**
 * Regression: cross-origin redirect must never forward the API key (QA-3 P1,
 * measured live: the x-api-key header followed a 302 to a second host).
 *
 * Two-sided control: the same server pair that leaks nothing must still serve
 * a normal (non-redirecting) fetch correctly with the key present.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHash } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { syncHooks } from "./sync.js";
import { readLock } from "./store.js";
import { closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-redirect-test-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
  process.env.HASNA_HOOKS_API_KEY = "test-sentinel-key-1234567890";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  delete process.env.HASNA_HOOKS_API_KEY;
  delete process.env.HASNA_HOOKS_API_URL;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function startRegistry(handler: (req: Request, url: URL) => Response): { base: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return handler(req, new URL(req.url));
    },
  });
  return { base: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

const SCRIPT = "console.log('redirect-demo');\n";
const SCRIPT_SHA = sha(SCRIPT);

function demoEndpoints(): Array<[string, Response]> {
  return [
    ["/api/v1/catalog", Response.json({ hooks: [{ name: "redirect-demo", version: "1.0.0", sha256: SCRIPT_SHA }] })],
    ["/api/v1/lock", Response.json({ hooks: { "redirect-demo": { version: "1.0.0", sha256: SCRIPT_SHA, source: "remote" } } })],
    ["/api/v1/hooks/redirect-demo/1.0.0", Response.json({
      manifest: { name: "redirect-demo", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" },
      script: SCRIPT,
    })],
  ];
}

describe("redirect handling (QA-3 P1 key-leak fix)", () => {
  test("known-positive control: a non-redirecting registry serves the sync with the key", async () => {
    const { base, stop } = startRegistry((req, url) => {
      if (req.headers.get("x-api-key") !== "test-sentinel-key-1234567890") {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      const found = demoEndpoints().find(([p]) => p === url.pathname);
      return found ? found[1] : new Response("not found", { status: 404 });
    });
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      const plan = await syncHooks();
      expect(plan.diff.added).toContain("redirect-demo");
      expect(readLock().hooks["redirect-demo"]?.version).toBe("1.0.0");
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      stop();
    }
  });

  test("a 302 to another origin is refused — the key never reaches the second host", async () => {
    // Host B: the redirect target. It records whether any x-api-key header
    // arrives and answers 404 (a dead-end registry).
    let leaked: string[] = [];
    const hostB = startRegistry((req) => {
      const key = req.headers.get("x-api-key");
      if (key) leaked.push(key);
      return new Response("not found", { status: 404 });
    });

    // Host A: redirects every path to host B (cross-origin by port).
    const hostA = startRegistry(() => {
      return Response.redirect(`${hostB.base}/api/v1/catalog`, 302);
    });

    try {
      process.env.HASNA_HOOKS_API_URL = hostA.base;
      await expect(syncHooks()).rejects.toThrow();
      // The fetch was refused at the redirect; the second origin never saw
      // the key header.
      expect(leaked).toHaveLength(0);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      hostA.stop();
      hostB.stop();
    }
  });

  test("a same-origin redirect is refused too (fail-closed, never follow)", async () => {
    const { base, stop } = startRegistry((_req, url) => {
      if (url.pathname === "/api/v1/redirect") {
        return Response.redirect(`${base}/api/v1/catalog`, 302);
      }
      return new Response("not found", { status: 404 });
    });
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      await expect(syncHooks()).rejects.toThrow();
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      stop();
    }
  });
});
