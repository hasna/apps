import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { handleServeRequest, DEFAULT_SERVE_PORT } from "./serve.js";
import { closeDb } from "./db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-openapi-test-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function req(method: string, path: string): Request {
  return new Request(`http://127.0.0.1:${DEFAULT_SERVE_PORT}${path}`, { method });
}

describe("serve OpenAPI surface", () => {
  test("GET /openapi.json returns an OpenAPI 3.1 document describing the real routes", async () => {
    const res = await handleServeRequest(req("GET", "/openapi.json"), undefined);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toStartWith("3.1");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/ready",
        "/version",
        "/openapi.json",
        "/api/v1/catalog",
        "/api/v1/lock",
        "/api/v1/hooks/{name}/{version}",
        "/api/v1/hooks",
      ]),
    );
  });

  test("GET /ready reports ready when the lock store is readable", async () => {
    const res = await handleServeRequest(req("GET", "/ready"), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", name: "hooks-registry" });
  });

  test("GET /version returns the package version", async () => {
    const res = await handleServeRequest(req("GET", "/version"), undefined);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
