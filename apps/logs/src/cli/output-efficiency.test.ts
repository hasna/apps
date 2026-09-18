import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "../db/index.ts";
import { ingestLog } from "../lib/ingest.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const savedEnv = {
  HASNA_LOGS_DB_PATH: process.env.HASNA_LOGS_DB_PATH,
  HASNA_LOGS_DATA_DIR: process.env.HASNA_LOGS_DATA_DIR,
  HASNA_LOGS_FSYNC: process.env.HASNA_LOGS_FSYNC,
};

afterEach(() => {
  closeDb();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function fixture(count = 40): string {
  const root = mkdtempSync(join(tmpdir(), "logs-output-efficiency-"));
  roots.push(root);
  process.env.HASNA_LOGS_DB_PATH = join(root, "logs.db");
  process.env.HASNA_LOGS_DATA_DIR = root;
  process.env.HASNA_LOGS_FSYNC = "0";
  const db = getDb();
  for (let index = 0; index < count; index += 1) {
    ingestLog(db, {
      id: `bounded-log-${String(index).padStart(3, "0")}`,
      level: index % 7 === 0 ? "error" : "info",
      source: "sdk",
      service: `service-${"s".repeat(120)}`,
      message: `message-${String(index).padStart(3, "0")}-${"😀payload ".repeat(1_200)}`,
    });
  }
  closeDb();
  return root;
}

function runCli(args: string[], root: string) {
  return Bun.spawnSync(["bun", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: root,
      HASNA_LOGS_API_URL: undefined,
      HASNA_LOGS_API_KEY: undefined,
      LOGS_API_URL: undefined,
      LOGS_API_KEY: undefined,
      HASNA_LOGS_LOCAL: "1",
      HASNA_LOGS_DB_PATH: join(root, "logs.db"),
      HASNA_LOGS_DATA_DIR: root,
      HASNA_LOGS_FSYNC: "0",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stdout(result: ReturnType<typeof runCli>): string {
  return new TextDecoder().decode(result.stdout);
}

describe("logs list output efficiency", () => {
  test("defaults to a 25-row compact identity preview under 32 KiB", () => {
    const root = fixture();
    const result = runCli(["list"], root);
    const text = stdout(result);

    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32 * 1024);
    expect(text).toContain("bounded-log-039");
    expect(text).toContain("bounded-log-015");
    expect(text).not.toContain("bounded-log-014");
    expect(text).toContain("next_offset=25");
    expect(text).toContain("logs get <id>");
    expect(text).not.toContain("😀payload ".repeat(100));
  });

  test("honors a smaller compact byte budget and reports a resumable offset", () => {
    const root = fixture();
    const result = runCli(
      ["list", "--format", "compact", "--limit", "100", "--max-bytes", "2048"],
      root,
    );
    const text = stdout(result);

    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2048);
    expect(text).toMatch(/Showing \d+ log\(s\).*next_offset=\d+/);
    expect(text).toContain("--offset");
  });

  test("help makes the compact default and byte/row controls discoverable", () => {
    const result = runCli(["list", "--help"], fixture(0));
    const text = stdout(result);

    expect(result.exitCode).toBe(0);
    expect(text).toContain('default: "compact"');
    expect(text).toContain('default: "25"');
    expect(text).toContain("--offset <n>");
    expect(text).toContain("--max-bytes <n>");
  });
});
