import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ENV_KEYS = [
  "HASNA_FILES_API_URL",
  "FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "FILES_API_KEY",
  "HASNA_FILES_MODE",
  "FILES_MODE",
  "HASNA_FILES_STORAGE_MODE",
  "FILES_STORAGE_MODE",
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
] as const;
const priorEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>;
const testDir = mkdtempSync(join(tmpdir(), "files-evidence-mcp-"));

for (const key of ENV_KEYS) delete process.env[key];
process.env.HASNA_FILES_STORAGE_MODE = "local";
process.env.HASNA_FILES_DATA_DIR = testDir;
process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");

const { closeDb } = await import("../db/database.js");
const { resetStoreCache } = await import("../store/index.js");
const { registerEvidenceTools } = await import("./evidence-tools.js");

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

afterAll(() => {
  closeDb();
  resetStoreCache();
  rmSync(testDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (priorEnv[key] === undefined) delete process.env[key];
    else process.env[key] = priorEnv[key];
  }
});

describe("evidence MCP transport safety", () => {
  test("redacts a propagated completion failure capability", async () => {
    const handlers = new Map<string, Handler>();
    registerEvidenceTools((name, _description, _schema, handler) => handlers.set(name, handler));
    const complete = handlers.get("complete_evidence_upload");
    expect(complete).toBeDefined();

    const opaqueCapability = "https://synthetic.invalid/transport/CANARY_MCP_OPAQUE";
    let caught: unknown;
    try {
      await complete!({ intent_id: opaqueCapability, storage: "local", local_root: testDir });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message.includes("CANARY_MCP_OPAQUE")).toBe(false);
    expect(message.includes("synthetic.invalid")).toBe(false);
    expect(message.includes("REDACTED")).toBe(true);
  });
});
