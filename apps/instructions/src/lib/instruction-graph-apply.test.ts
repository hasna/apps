import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, ProfileConfigBinding } from "../types/index.js";
import { PROFILE_CONFIG_BINDING_SCHEMA } from "../types/index.js";
import { applySessionRender, restoreSessionRenderSnapshot } from "./session-apply.js";
import { InstructionGraphValidationError, planProfileSessionRender } from "./instruction-graph.js";
import { makeTempRoot } from "./test-temp-root.js";

let root: string;

beforeEach(() => { root = makeTempRoot("instructions-graph-apply-"); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function config(id: string, content: string): Config {
  return {
    id, name: id, slug: id, kind: "file", category: "rules", agent: "global",
    target_path: null, outputs: [], format: "markdown", content, description: null,
    tags: [], is_template: false, version: 1, created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", synced_at: null,
  };
}

function binding(id: string, dependsOn: string[] = []): ProfileConfigBinding {
  return {
    profile_id: "profile-1", config_id: id, sort_order: 0,
    binding: {
      schema: PROFILE_CONFIG_BINDING_SCHEMA,
      activation: { mode: "always" }, required: true, fallback: "fail",
      ...(dependsOn.length ? { depends_on: dependsOn } : {}),
    },
  };
}

function plan(configs: Config[], bindings: ProfileConfigBinding[]) {
  return planProfileSessionRender({
    profile_id: "profile-1", provider_version: "1.0.0", tool: "codex", profile: "profile-1",
    targetHome: root, generatedAt: "2026-01-01T00:00:00.000Z", configs, bindings,
  });
}

describe("instruction graph apply boundary", () => {
  test("invalid graph and output collision both fail before any write", () => {
    expect(() => plan([config("a", "A"), config("b", "B")], [binding("a", ["b"]), binding("b", ["a"])]))
      .toThrow(InstructionGraphValidationError);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);

    const duplicateSlugA = config("one", "one");
    const duplicateSlugB = { ...config("two", "two"), slug: "one" };
    expect(() => plan([duplicateSlugA, duplicateSlugB], [binding("one"), binding("two")]))
      .toThrow(/Duplicate session (render file path|instruction source slug)/);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
  });

  test("unmanaged files are preserved when apply reports a collision", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "human-owned\n");
    const result = applySessionRender(plan([config("rule", "managed\n")], [binding("rule")]));
    expect(result.applied).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("human-owned\n");
  });

  test("compiled graph uses existing snapshots for exact rollback", () => {
    const first = applySessionRender(plan([config("rule", "first\n")], [binding("rule")]));
    expect(first.applied).toBe(true);
    const before = readFileSync(join(root, "AGENTS.md"), "utf8");
    const secondConfig = { ...config("rule", "second\n"), version: 2 };
    const second = applySessionRender(plan([secondConfig], [binding("rule")]));
    expect(second.snapshotPath).not.toBeNull();
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).not.toBe(before);
    const restored = restoreSessionRenderSnapshot(second.snapshotPath!);
    expect(restored.restored).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(before);
  });
});
