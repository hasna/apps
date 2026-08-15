import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, ProfileConfigBinding, ProfileConfigBindingSpec } from "../types/index.js";
import { applySessionRender, restoreSessionRenderSnapshot } from "./session-apply.js";
import {
  InstructionGraphValidationError,
  legacyProfileConfigBinding,
  planProfileSessionRender,
} from "./instruction-graph.js";
import { planSessionRender } from "./session-render.js";
import { tempRootPath } from "./test-temp-root.js";

const SENTINEL = "OPEN_CODE_EXACT_ONCE_SENTINEL";

function config(id: string, content = `${SENTINEL}\n`): Config {
  return {
    id,
    name: id,
    slug: id,
    kind: "file",
    category: "rules",
    agent: "global",
    target_path: null,
    outputs: [],
    format: "markdown",
    content,
    description: null,
    tags: [],
    is_template: false,
    version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    synced_at: null,
  };
}

function spec(overrides: Partial<ProfileConfigBindingSpec> = {}): ProfileConfigBindingSpec {
  return { ...legacyProfileConfigBinding(), ...overrides };
}

function binding(configId: string, value = spec(), sortOrder = 0): ProfileConfigBinding {
  return { profile_id: "profile-1", config_id: configId, sort_order: sortOrder, binding: value };
}

function countSentinel(value: string): number {
  return value.split(SENTINEL).length - 1;
}

function providerLoadedSentinelCount(plan: ReturnType<typeof planProfileSessionRender>): number {
  const configFile = plan.files.find((file) => file.relativePath === "opencode.json");
  const providerConfig = configFile ? JSON.parse(configFile.content) as { instructions?: string[] } : {};
  const instructionFiles = new Set((providerConfig.instructions ?? []).filter((path) => path.startsWith(".hasna/instructions/")));
  return plan.files.reduce((count, file) => {
    const loaded = file.relativePath === "AGENTS.md" || instructionFiles.has(file.relativePath);
    return count + (loaded ? countSentinel(file.content) : 0);
  }, 0);
}

describe("versioned provider adapters", () => {
  test("Cursor compiled glob and always bindings retain distinct activation semantics", () => {
    const root = tempRootPath("instructions-cursor-capability-");
    try {
      const plan = planProfileSessionRender({
        profile_id: "profile-1",
        provider_version: "1.2.3",
        tool: "cursor",
        profile: "profile-1",
        projectRoot: root,
        cursorAuthorityHome: join(root, "authority"),
        generatedAt: "2026-01-01T00:00:00.000Z",
        configs: [config("typescript", "TS_ONLY"), config("always", "ALWAYS")],
        bindings: [
          binding("typescript", spec({ activation: { mode: "glob", globs: ["src/**/*.ts"] } }), 0),
          binding("always", spec(), 1),
        ],
      });
      const globRule = plan.files.find((file) => file.content.includes("TS_ONLY"))!;
      const alwaysRule = plan.files.find((file) => file.content.includes("ALWAYS"))!;
      const matcher = new Bun.Glob("src/**/*.ts");

      expect(globRule.content).toContain('globs: ["src/**/*.ts"]');
      expect(globRule.content).toContain("alwaysApply: false");
      expect(matcher.match("src/app/main.ts")).toBe(true);
      expect(matcher.match("src/app/main.js")).toBe(false);
      expect(alwaysRule.content).toContain("alwaysApply: true");
      expect(plan.instructionGraph.capability.loading_path).toBe(".cursor/rules/*.mdc");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Cursor non-compiled sources retain legacy always-on behavior", () => {
    const root = tempRootPath("instructions-cursor-legacy-");
    try {
      const plan = planSessionRender({
        tool: "cursor",
        profile: "legacy",
        projectRoot: root,
        cursorAuthorityHome: join(root, "authority"),
        sources: [{
          id: "legacy",
          content: "LEGACY",
          globs: ["src/**/*.ts"],
          metadata: { activation: { mode: "glob", description: "untrusted legacy metadata" } },
        }],
      });
      const rendered = plan.files.find((file) => file.content.includes("LEGACY"))!;
      expect(rendered.content).toContain('globs: ["src/**/*.ts"]');
      expect(rendered.content).toContain("alwaysApply: true");
      expect(rendered.content).not.toContain("untrusted legacy metadata");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("OpenCode v1 and v2 choose one provider-loaded representation and preserve config fields", () => {
    const root = tempRootPath("instructions-opencode-capability-");
    try {
      const providerConfig = {
        sourceId: "provider-config",
        content: JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "example/model",
          mcp: { example: { enabled: false } },
          instructions: ["manual.md"],
        }),
      };
      const common = {
        profile_id: "profile-1",
        tool: "opencode" as const,
        profile: "profile-1",
        targetHome: root,
        generatedAt: "2026-01-01T00:00:00.000Z",
        configs: [config("exact-once")],
        bindings: [binding("exact-once")],
        providerConfig,
      };
      const stable = planProfileSessionRender({ ...common, provider_version: "1.18.18" });
      const next = planProfileSessionRender({
        ...common,
        provider_version: "0.0.0",
        graph_context: { provider_variant: "v2-agents" },
      });

      expect(stable.instructionGraph.capability).toEqual(expect.objectContaining({
        schema: "hasna.instructions.provider-capability/v1",
        provider_variant: "v1-instructions",
        selected_representation: "managed-fragment",
        loading_path: "opencode.json instructions",
      }));
      expect(stable.instructionGraph.artifacts).toEqual([
        expect.objectContaining({ representation: "managed-fragment", loading_path: "opencode.json instructions" }),
      ]);
      expect(stable.files.some((file) => file.relativePath === "AGENTS.md")).toBe(false);
      expect(providerLoadedSentinelCount(stable)).toBe(1);
      const stableConfig = JSON.parse(stable.files.find((file) => file.relativePath === "opencode.json")!.content);
      expect(stableConfig.model).toBe("example/model");
      expect(stableConfig.mcp).toEqual({ example: { enabled: false } });
      expect(stableConfig.instructions).toContain("manual.md");

      expect(next.instructionGraph.capability).toEqual(expect.objectContaining({
        provider_variant: "v2-agents",
        selected_representation: "flattened",
        loading_path: "AGENTS.md",
      }));
      expect(next.instructionGraph.artifacts).toEqual([
        expect.objectContaining({ representation: "flattened", loading_path: "AGENTS.md" }),
      ]);
      expect(Object.isFrozen(next.instructionGraph)).toBe(true);
      expect(Object.isFrozen(next.instructionGraph.capability)).toBe(true);
      expect(next.files.some((file) => file.role === "fragment")).toBe(false);
      expect(providerLoadedSentinelCount(next)).toBe(1);
      const nextConfig = JSON.parse(next.files.find((file) => file.relativePath === "opencode.json")!.content);
      expect(nextConfig.model).toBe("example/model");
      expect(nextConfig.instructions).toEqual(["manual.md"]);
      expect(next.instructionGraph.source_hash).not.toBe(stable.instructionGraph.source_hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("unknown variants and unsupported required versions fail before any write", () => {
    const root = tempRootPath("instructions-opencode-invalid-");
    const common = {
      profile_id: "profile-1",
      tool: "opencode" as const,
      profile: "profile-1",
      targetHome: root,
      configs: [config("required")],
      bindings: [binding("required")],
    };
    try {
      expect(() => planProfileSessionRender({
        ...common,
        provider_version: "1.18.18",
        graph_context: { provider_variant: "unknown" },
      })).toThrow(InstructionGraphValidationError);
      expect(() => planProfileSessionRender({ ...common, provider_version: "0.0.1" })).toThrow(/PROVIDER_VERSION_UNSUPPORTED/);
      expect(existsSync(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("explicit fallback is recorded and repeated plans are deterministic", () => {
    const common = {
      profile_id: "profile-1",
      provider_version: "1.0.0",
      tool: "codex" as const,
      profile: "profile-1",
      targetHome: "/tmp/instructions-provider-fallback",
      generatedAt: "2026-01-01T00:00:00.000Z",
      configs: [config("model-rule")],
      bindings: [binding("model-rule", spec({ activation: { mode: "model", models: ["gpt-5"] }, fallback: "flatten" }))],
      graph_context: { model: "gpt-5" },
    };
    const first = planProfileSessionRender(common);
    const second = planProfileSessionRender(common);

    expect(first.instructionGraph.diagnostics).toContainEqual(expect.objectContaining({ code: "FALLBACK_APPLIED" }));
    expect(first.instructionGraph.units[0]?.effective_activation.mode).toBe("always");
    expect(first.instructionGraph.source_hash).toBe(second.instructionGraph.source_hash);
    expect(first.allFiles.map((file) => file.sha256)).toEqual(second.allFiles.map((file) => file.sha256));
  });

  test("OpenCode surface transition preserves unmanaged files and snapshot rollback restores the v1 preimage", () => {
    const root = tempRootPath("instructions-opencode-rollback-");
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "operator-notes.md"), "unmanaged\n");
      const common = {
        profile_id: "profile-1",
        tool: "opencode" as const,
        profile: "profile-1",
        targetHome: root,
        generatedAt: "2026-01-01T00:00:00.000Z",
        configs: [config("exact-once")],
        bindings: [binding("exact-once")],
      };
      const stable = planProfileSessionRender({ ...common, provider_version: "1.18.18" });
      expect(applySessionRender(stable).applied).toBe(true);
      const v1Config = readFileSync(join(root, "opencode.json"), "utf8");
      const next = planProfileSessionRender({
        ...common,
        provider_version: "0.0.0",
        graph_context: { provider_variant: "v2-agents" },
      });
      const applied = applySessionRender(next);
      expect(applied.applied).toBe(true);
      expect(applied.snapshotPath).not.toBeNull();
      expect(readFileSync(join(root, "operator-notes.md"), "utf8")).toBe("unmanaged\n");
      expect(existsSync(join(root, "AGENTS.md"))).toBe(true);

      const restored = restoreSessionRenderSnapshot(applied.snapshotPath!);
      expect(restored.restored).toBe(true);
      expect(readFileSync(join(root, "opencode.json"), "utf8")).toBe(v1Config);
      expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
      expect(readFileSync(join(root, "operator-notes.md"), "utf8")).toBe("unmanaged\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
