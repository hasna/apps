import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRestRequest } from "./serve.js";

const ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "OPEN_FILES_REST_ALLOWED_ORIGINS",
  "OPEN_FILES_REST_ALLOW_ORIGINS",
  "OPEN_FILES_REST_ALLOW_ANY_ORIGIN",
  "OPEN_FILES_REST_HOST",
] as const;

const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-serve-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  delete process.env.OPEN_FILES_REST_ALLOWED_ORIGINS;
  delete process.env.OPEN_FILES_REST_ALLOW_ORIGINS;
  delete process.env.OPEN_FILES_REST_ALLOW_ANY_ORIGIN;
  delete process.env.OPEN_FILES_REST_HOST;
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("files-serve REST origin protection", () => {
  test("rejects arbitrary browser origins before exposing file metadata", async () => {
    await seedIndexedFile();

    const response = await request("/files", "https://attacker.example");
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toEqual({ error: "Origin not allowed" });
  });

  test("rejects unconfigured loopback browser origins", async () => {
    await seedIndexedFile();

    const response = await request("/files", "http://localhost:5173");
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("allows configured browser origins without wildcard CORS", async () => {
    process.env.OPEN_FILES_REST_ALLOWED_ORIGINS = "http://localhost:5173";
    await seedIndexedFile();

    const response = await request("/files", "http://localhost:5173");
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");

    const files = await response.json() as Array<{ path: string }>;
    expect(files.map((file) => file.path)).toContain("secret/local-plan.txt");
  });

  test("allows same-origin browser requests", async () => {
    await seedIndexedFile();

    const response = await request("/files", "http://127.0.0.1:19432");
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:19432");
  });

  test("keeps non-browser local clients working without CORS headers", async () => {
    const source = await seedIndexedFile();

    const response = await request("/sources");
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const sources = await response.json() as Array<{ id: string; path?: string }>;
    expect(sources).toContainEqual(expect.objectContaining({ id: source.id, path: testDir }));
  });

  test("denies untrusted preflight requests", async () => {
    const denied = await request("/files", "https://attacker.example", "OPTIONS");
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();

    process.env.OPEN_FILES_REST_ALLOWED_ORIGINS = "http://127.0.0.1:3000";
    const allowed = await request("/files", "http://127.0.0.1:3000", "OPTIONS");
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:3000");
    expect(allowed.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

async function seedIndexedFile(): Promise<{ id: string }> {
  const { getCurrentMachine } = await import("../db/machines.js");
  const { createSource } = await import("../db/sources.js");
  const { upsertFile } = await import("../db/files.js");

  const machine = getCurrentMachine();
  const source = createSource({
    name: "Local secrets",
    type: "local",
    path: testDir,
    machine_id: machine.id,
  });
  upsertFile({
    source_id: source.id,
    machine_id: machine.id,
    path: "secret/local-plan.txt",
    name: "local-plan.txt",
    ext: ".txt",
    size: 42,
    mime: "text/plain",
    status: "active",
  });
  return source;
}

function request(path: string, origin?: string, method = "GET"): Promise<Response> {
  return handleRestRequest(
    new Request(`http://127.0.0.1:19432${path}`, {
      method,
      headers: origin ? { Origin: origin } : undefined,
    }),
  );
}
