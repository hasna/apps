import { describe, expect, test } from "bun:test";
import type { Config, ProfileConfigBinding, ProfileConfigBindingSpec } from "../types/index.js";
import { PROFILE_CONFIG_BINDING_SCHEMA } from "../types/index.js";
import {
  InstructionGraphValidationError,
  PROVIDER_CAPABILITIES,
  compileInstructionGraph,
  legacyProfileConfigBinding,
  planProfileSessionRender,
  type ProviderCapability,
} from "./instruction-graph.js";

function config(id: string, content = `# ${id}\n`): Config {
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

function binding(configId: string, bindingSpec = spec(), sortOrder = 0): ProfileConfigBinding {
  return { profile_id: "profile-1", config_id: configId, sort_order: sortOrder, binding: bindingSpec };
}

function compile(configs: Config[], bindings: ProfileConfigBinding[], provider: "codex" | "cursor" = "codex") {
  return compileInstructionGraph({
    profile_id: "profile-1",
    configs,
    bindings,
    context: { provider, provider_version: "1.2.3", path: "src/app.ts" },
  });
}

describe("instruction graph compiler", () => {
  test("refuses to inject application settings from a legacy mixed profile", () => {
    const settings = { ...config("shell-config", "export EXAMPLE=1"), category: "shell" as const, format: "text" as const };
    expect(() => compile([config("prose"), settings], [])).toThrow("category shell is not an instruction source");
    const optional = compile([config("prose"), settings], [binding(settings.id, spec({ required: false, fallback: "omit" }))]);
    expect(optional.sources.map((source) => source.id)).toEqual(["prose"]);
    expect(optional.plan.diagnostics.some((entry) => entry.code === "SOURCE_NOT_INSTRUCTION")).toBe(true);
  });

  test("honors provider scope on legacy bindings and permits an explicit reviewed reuse", () => {
    const claudeRule = { ...config("claude-only"), agent: "claude" as const };
    expect(compile([claudeRule, config("global")], []).sources.map((source) => source.id)).toEqual(["global"]);
    const explicit = binding(claudeRule.id, spec({ providers: [{ provider: "codex" }] }));
    expect(compile([claudeRule], [explicit]).sources.map((source) => source.id)).toEqual(["claude-only"]);
  });

  test("refuses retired rules, unresolved templates, settings and execution policies", () => {
    for (const source of [
      { ...config("retired"), tags: ["retired-global-source"] },
      { ...config("template"), is_template: true },
      { ...config("settings"), format: "json" as const },
      { ...config("policy"), target_path: "~/.codex/rules/default.rules" },
    ]) expect(() => compile([source], [])).toThrow(InstructionGraphValidationError);
  });

  test("uses a declared provider output when compiling source prose", () => {
    const source = { ...config("shared-rule", "# Reviewed prose\n\n<!-- claude-only:start -->\nProvider-specific command\n<!-- claude-only:end -->\n"), agent: "claude" as const, outputs: [{ agent: "codex" as const, target_path: "AGENTS.md", transform: "codex-flat" as const }] };
    const excluded = { ...config("excluded", "Unselected provider rule"), agent: "claude" as const, target_path: "~/.claude/rules/excluded.md" };
    const compiled = compile([source, excluded], []);
    expect(compiled.sources).toHaveLength(1);
    expect(compiled.sources[0]!.content).toContain("# Reviewed prose");
    expect(compiled.sources[0]!.content).not.toContain("Provider-specific command");
    expect(compiled.sources[0]!.content).not.toContain("Unselected provider rule");
  });

  test("is deterministic and emits exactly one provider artifact per selected unit", () => {
    const configs = [config("second"), config("first")];
    const bindings = [
      binding("second", spec({ depends_on: ["first"] }), 0),
      binding("first", spec(), 1),
    ];
    const left = compile(configs, bindings);
    const right = compile([...configs].reverse(), [...bindings].reverse());

    expect(left.plan.source_hash).toBe(right.plan.source_hash);
    expect(left.plan.units.map((unit) => unit.config_id)).toEqual(["first", "second"]);
    expect(left.plan.artifacts).toHaveLength(left.plan.units.length);
    expect(new Set(left.plan.artifacts.map((artifact) => artifact.unit_id))).toEqual(
      new Set(left.plan.units.map((unit) => unit.unit_id)),
    );
  });

  test("allows the same config to have independent bindings in different profiles", () => {
    const shared = config("shared");
    const first = compileInstructionGraph({
      profile_id: "profile-a",
      configs: [shared],
      bindings: [{ profile_id: "profile-a", config_id: shared.id, sort_order: 0, binding: spec() }],
      context: { provider: "codex", provider_version: "1.0.0" },
    });
    const second = compileInstructionGraph({
      profile_id: "profile-b",
      configs: [shared],
      bindings: [{ profile_id: "profile-b", config_id: shared.id, sort_order: 0, binding: spec({ activation: { mode: "manual" }, required: false, fallback: "omit" }) }],
      context: { provider: "codex", provider_version: "1.0.0" },
    });
    expect(first.plan.units).toHaveLength(1);
    expect(second.plan.units).toHaveLength(0);
  });

  test("rejects dependency cycles before creating a render plan", () => {
    expect(() => compile([config("a"), config("b")], [
      binding("a", spec({ depends_on: ["b"] }), 0),
      binding("b", spec({ depends_on: ["a"] }), 1),
    ])).toThrow(InstructionGraphValidationError);
    try {
      compile([config("a"), config("b")], [binding("a", spec({ depends_on: ["b"] })), binding("b", spec({ depends_on: ["a"] }))]);
    } catch (error) {
      expect((error as InstructionGraphValidationError).diagnostics.some((entry) => entry.code === "GRAPH_CYCLE")).toBe(true);
    }
  });

  test("resolves chained replacements independently of caller order", () => {
    const configs = [config("a"), config("b"), config("c")];
    const bindings = [
      binding("a", spec({ replaces: ["b"] }), 0),
      binding("b", spec({ replaces: ["c"] }), 1),
      binding("c", spec(), 2),
    ];

    const forward = compile(configs, bindings);
    const reversed = compile([...configs].reverse(), [...bindings].reverse());

    expect(forward.plan.units.map((unit) => unit.config_id)).toEqual(["a"]);
    expect(reversed.plan.units.map((unit) => unit.config_id)).toEqual(["a"]);
    expect(reversed.plan.source_hash).toBe(forward.plan.source_hash);
  });

  test("rejects replacement cycles deterministically", () => {
    const configs = [config("a"), config("b")];
    const bindings = [
      binding("a", spec({ replaces: ["b"] }), 0),
      binding("b", spec({ replaces: ["a"] }), 1),
    ];
    const diagnostics = (orderedConfigs: Config[], orderedBindings: ProfileConfigBinding[]) => {
      try {
        compile(orderedConfigs, orderedBindings);
        throw new Error("expected replacement cycle failure");
      } catch (error) {
        expect(error).toBeInstanceOf(InstructionGraphValidationError);
        return (error as InstructionGraphValidationError).diagnostics.filter((entry) => entry.code === "GRAPH_REPLACEMENT_CYCLE");
      }
    };

    const forward = diagnostics(configs, bindings);
    const reversed = diagnostics([...configs].reverse(), [...bindings].reverse());
    expect(forward).toEqual([expect.objectContaining({ message: "Instruction replacement cycle: a -> b -> a" })]);
    expect(reversed).toEqual(forward);
  });

  test("rejects unsupported required activation with fail fallback", () => {
    expect(() => compileInstructionGraph({
      profile_id: "profile-1",
      configs: [config("model-only")],
      bindings: [binding("model-only", spec({ activation: { mode: "model", models: ["gpt-5"] }, fallback: "fail" }))],
      context: { provider: "codex", provider_version: "1.0.0", model: "gpt-5" },
    })).toThrow(/REQUIRED_CAPABILITY_UNSUPPORTED/);
  });

  test("rejects a fallback absent from the code-owned capability descriptor", () => {
    const capability: ProviderCapability = {
      ...PROVIDER_CAPABILITIES.codex,
      supported_fallbacks: ["fail"],
    };
    expect(() => compileInstructionGraph({
      profile_id: "profile-1",
      configs: [config("model-only")],
      bindings: [binding("model-only", spec({ activation: { mode: "model", models: ["gpt-5"] }, fallback: "flatten" }))],
      context: { provider: "codex", provider_version: "1.0.0", model: "gpt-5" },
      capability,
    })).toThrow(/FALLBACK_UNDECLARED/);
  });

  test("detects provider version mismatch and graph conflicts", () => {
    expect(() => compileInstructionGraph({
      profile_id: "profile-1",
      configs: [config("a")],
      bindings: [binding("a")],
      context: { provider: "codex", provider_version: "0.0.1" },
    })).toThrow(/PROVIDER_VERSION_UNSUPPORTED/);
    expect(() => compile([config("a"), config("b")], [
      binding("a", spec({ conflicts_with: ["b"] })),
      binding("b", spec(), 1),
    ])).toThrow(/GRAPH_CONFLICT/);
  });

  test("legacy configs without explicit binding rows remain always-on", () => {
    const result = compile([config("legacy")], []);
    expect(result.plan.units[0]?.activation).toEqual({ mode: "always" });
    expect(result.sources[0]?.content).toContain("legacy");
  });

  test("cursor glob activation renders matching conditional frontmatter", () => {
    const targetHome = "/tmp/instruction-graph-cursor-project";
    const plan = planProfileSessionRender({
      profile_id: "profile-1",
      provider_version: "1.2.3",
      tool: "cursor",
      profile: "profile-1",
      projectRoot: targetHome,
      cursorAuthorityHome: "/tmp/instruction-graph-cursor-authority",
      generatedAt: "2026-01-01T00:00:00.000Z",
      configs: [config("typescript")],
      bindings: [binding("typescript", spec({ activation: { mode: "glob", globs: ["**/*.ts"], description: "TypeScript rules" } }))],
    });
    const rendered = plan.files.find((file) => file.relativePath.endsWith("typescript.mdc"))!;
    expect(rendered.content).toContain('globs: ["**/*.ts"]');
    expect(rendered.content).toContain("alwaysApply: false");
    expect(rendered.content).toContain('description: "TypeScript rules"');
    expect(rendered.content).not.toContain('globs: ["**/*"]');
  });

  test("provider filtering keeps nonmatching bindings out of the immutable plan", () => {
    const bindingSpec = spec({
      providers: [{ provider: "cursor", version_range: ">=1.0.0" }],
    });
    expect(compile([config("cursor-only")], [binding("cursor-only", bindingSpec)]).plan.units).toHaveLength(0);
    expect(compile([config("cursor-only")], [binding("cursor-only", bindingSpec)], "cursor").plan.units).toHaveLength(1);
  });

  test("exposes a schema-versioned serializable graph plan", () => {
    const result = compile([config("serial")], [binding("serial", {
      schema: PROFILE_CONFIG_BINDING_SCHEMA,
      activation: { mode: "always", directory_scope: "src" },
      required: true,
      fallback: "fail",
    })]);
    expect(JSON.parse(JSON.stringify(result.plan))).toEqual(result.plan);
    expect(result.plan.schema).toBe("hasna.instructions.render-plan/v1");
  });
});
