import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database";
import { createConfig } from "../db/configs";
import { applyConfig } from "./apply";

let tmpDir: string;

beforeEach(() => {
  resetDatabase();
  process.env["CONFIGS_DB_PATH"] = ":memory:";
  tmpDir = join(tmpdir(), `configs-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["CONFIGS_DB_PATH"];
});

describe("applyConfig", () => {
  test("writes content to target_path", async () => {
    const db = getDatabase();
    const target = join(tmpDir, "test.md");
    const c = createConfig({ name: "T", category: "rules", content: "hello", target_path: target }, db);
    await applyConfig(c, { db });
    expect(readFileSync(target, "utf-8")).toBe("hello");
  });

  test("dry-run does not write", async () => {
    const db = getDatabase();
    const target = join(tmpDir, "dry.md");
    const c = createConfig({ name: "T", category: "rules", content: "hello", target_path: target }, db);
    const result = await applyConfig(c, { dryRun: true, db });
    expect(existsSync(target)).toBe(false);
    expect(result.dry_run).toBe(true);
  });

  test("creates parent directories", async () => {
    const db = getDatabase();
    const target = join(tmpDir, "deep", "nested", "file.txt");
    const c = createConfig({ name: "T", category: "tools", content: "data", target_path: target }, db);
    await applyConfig(c, { db });
    expect(existsSync(target)).toBe(true);
  });

  test("returns changed=false when content identical", async () => {
    const db = getDatabase();
    const target = join(tmpDir, "same.txt");
    writeFileSync(target, "same");
    const c = createConfig({ name: "T", category: "tools", content: "same", target_path: target }, db);
    const result = await applyConfig(c, { db });
    expect(result.changed).toBe(false);
  });

  test("returns previous_content when overwriting", async () => {
    const db = getDatabase();
    const target = join(tmpDir, "existing.txt");
    writeFileSync(target, "old content");
    const c = createConfig({ name: "T", category: "tools", content: "new content", target_path: target }, db);
    const result = await applyConfig(c, { db });
    expect(result.previous_content).toBe("old content");
    expect(result.new_content).toBe("new content");
  });

  test("throws for reference kind", async () => {
    const db = getDatabase();
    const c = createConfig({ name: "Ref", category: "workspace", content: "doc", kind: "reference" }, db);
    expect(applyConfig(c, { db })).rejects.toThrow("reference");
  });
});
