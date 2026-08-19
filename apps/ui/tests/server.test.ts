// ui-local server endpoints over an ephemeral port (UI_LOCAL_PORT=0).
//
// The server module starts on import using the configured port; the test sets
// UI_LOCAL_PORT=0 before importing so Bun assigns a free port, reads the real
// bound port from the exported server object, and stops the server in
// afterAll. No fixed port ranges are ever used.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { CONTENT_DIR_ENV } from "../src/content.ts";
import { createSyntheticMirror, type SyntheticMirror } from "./helpers/synthetic-mirror.ts";

const originalPort = process.env.UI_LOCAL_PORT;
const originalContentDir = process.env[CONTENT_DIR_ENV];
process.env.UI_LOCAL_PORT = "0";

const { server } = await import("../src/server.ts");
const base = server.url;

afterAll(() => {
  server.stop(true);
  if (originalPort === undefined) delete process.env.UI_LOCAL_PORT;
  else process.env.UI_LOCAL_PORT = originalPort;
  if (originalContentDir === undefined) delete process.env[CONTENT_DIR_ENV];
  else process.env[CONTENT_DIR_ENV] = originalContentDir;
});

afterEach(() => {
  if (originalContentDir === undefined) delete process.env[CONTENT_DIR_ENV];
  else process.env[CONTENT_DIR_ENV] = originalContentDir;
});

describe("ui-local server", () => {
  test("GET /health returns ok", async () => {
    const res = await fetch(`${base}health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("GET /ui-picker.js serves the picker with no-cache semantics", async () => {
    const res = await fetch(`${base}ui-picker.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("uidotsh-picker");
  });

  test("GET /fetch returns the mirrored resource as markdown", async () => {
    const mirror: SyntheticMirror = await createSyntheticMirror(45);
    try {
      process.env[CONTENT_DIR_ENV] = mirror.dir;
      const res = await fetch(`${base}fetch?uri=uidotsh%3A%2F%2Fui`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(await res.text()).toContain("Subskills");
    } finally {
      await rm(mirror.dir, { recursive: true, force: true });
    }
  });

  test("GET /fetch with a missing uri returns 404 with the typed message", async () => {
    const mirror: SyntheticMirror = await createSyntheticMirror(45);
    try {
      process.env[CONTENT_DIR_ENV] = mirror.dir;
      const res = await fetch(`${base}fetch?uri=uidotsh%3A%2F%2Fui%2Fmissing`);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain("No mirrored resource for uidotsh://ui/missing");
    } finally {
      await rm(mirror.dir, { recursive: true, force: true });
    }
  });

  test("GET /fetch without a mirror returns 404 with setup guidance", async () => {
    const emptyDir = await import("node:fs/promises").then((m) => m.mkdtemp("/tmp/hasna-ui-server-"));
    try {
      process.env[CONTENT_DIR_ENV] = emptyDir;
      const res = await fetch(`${base}fetch?uri=uidotsh%3A%2F%2Fui`);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toContain("does not redistribute ui.sh content");
      expect(body).toContain("ui harvest");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test("root demo defaults to the local picker", async () => {
    const res = await fetch(`${base}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain('<script src="/ui-picker.js">');
    expect(html).toContain("picker: local");
    expect(html).not.toContain("/ui-picker.reference.js");
  });

  test("index.html with picker=reference uses the reference script source", async () => {
    const res = await fetch(`${base}index.html?picker=reference`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script src="/ui-picker.reference.js">');
    expect(html).toContain("picker: reference");
    expect(html).not.toContain('<script src="/ui-picker.js">');
  });

  test("unknown picker values fall back to local", async () => {
    const res = await fetch(`${base}?picker=bogus`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script src="/ui-picker.js">');
    expect(html).toContain("picker: local");
  });

  test("unknown paths return 404 not found", async () => {
    const res = await fetch(`${base}does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });
});
