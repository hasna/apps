import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, startTask } from "../db/tasks.js";
import {
  validateTaskAgainstPolicyPack,
  getDefaultPolicyPacks,
  savePolicyPacks,
  resetPolicyPackCache,
  assertPolicyPackPassed,
} from "./policy-packs.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  resetPolicyPackCache();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  resetPolicyPackCache();
});

describe("validateTaskAgainstPolicyPack", () => {
  it("passes default pack for in-progress task without approval requirement", () => {
    const task = createTask({ title: "Simple" });
    startTask(task.id, "agent-1");
    const result = validateTaskAgainstPolicyPack(task.id, "default", { dry_run: true });
    expect(result.passed).toBe(true);
    expect(result.dry_run).toBe(true);
  });

  it("fails when task not in_progress", () => {
    const task = createTask({ title: "Pending" });
    const result = validateTaskAgainstPolicyPack(task.id, "default");
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.rule === "require_in_progress")).toBe(true);
  });

  it("fails strict pack without verification and evidence", () => {
    const task = createTask({ title: "Strict test" });
    startTask(task.id, "agent-1");
    const result = validateTaskAgainstPolicyPack(task.id, "strict");
    expect(result.passed).toBe(false);
    expect(result.explanations.length).toBeGreaterThan(0);
  });

  it("detects secrets in metadata", () => {
    const task = createTask({ title: "Leaky", metadata: { note: "key sk-1234567890abcdef" } });
    startTask(task.id, "agent-1");
    const result = validateTaskAgainstPolicyPack(task.id, "default");
    expect(result.violations.some((v) => v.rule === "secret_scan_metadata")).toBe(true);
  });
});

describe("assertPolicyPackPassed", () => {
  it("throws on violation", () => {
    const task = createTask({ title: "Fail assert" });
    expect(() => assertPolicyPackPassed(task.id)).toThrow("Policy pack");
  });
});

describe("policy pack config", () => {
  it("loads custom packs from file", () => {
    savePolicyPacks([{ name: "minimal", version: 1, rules: [{ type: "require_in_progress" }] }]);
    resetPolicyPackCache();
    const result = validateTaskAgainstPolicyPack(createTask({ title: "X" }).id, "minimal");
    expect(result.pack_name).toBe("minimal");
  });

  it("default packs are local-only", () => {
    for (const p of getDefaultPolicyPacks()) {
      expect(JSON.stringify(p)).not.toMatch(/todos\.md|platform-todos/i);
    }
  });
});
