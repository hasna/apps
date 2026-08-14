import { describe, expect, test } from "bun:test";
import type { Config, ConfigAgent, ProfileConfigBinding, ProfileConfigBindingSpec } from "../types/index.js";
import { PROFILE_CONFIG_BINDING_SCHEMA } from "../types/index.js";
import {
  PROVIDER_CAPABILITY_DESCRIPTORS,
  planProfileSessionRender,
  selectProviderCapability,
} from "./instruction-graph.js";
import { SESSION_RENDER_TOOLS, type SessionRenderTool } from "./session-render.js";

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

function binding(id: string, activation: ProfileConfigBindingSpec["activation"] = { mode: "always" }): ProfileConfigBinding {
  return {
    profile_id: "profile-1",
    config_id: id,
    sort_order: 0,
    binding: {
      schema: PROFILE_CONFIG_BINDING_SCHEMA,
      activation,
      required: true,
      fallback: "fail",
    },
  };
}

function plan(tool: SessionRenderTool, options: {
  activation?: ProfileConfigBindingSpec["activation"];
  providerVariant?: string;
} = {}) {
  const source = config(`${tool}-rules`, `# ${tool}\n\nProvider-specific rules.\n`);
  return planProfileSessionRender({
    profile_id: "profile-1",
    provider_version: "1.2.3",
    tool,
    profile: "profile-1",
    projectRoot: `/tmp/instructions-provider-${tool}`,
    generatedAt: "2026-01-01T00:00:00.000Z",
    configs: [source],
    bindings: [binding(source.id, options.activation)],
    graph_context: {
      ...(options.providerVariant ? { provider_variant: options.providerVariant } : {}),
      ...(options.activation?.mode === "model" && options.activation.models?.[0]
        ? { model: options.activation.models[0] }
        : {}),
    },
  });
}

describe("remaining provider capability descriptors", () => {
  test("declares every active provider and keeps OpenCode and Copilot surfaces versioned", () => {
    const expected: ConfigAgent[] = ["grok", "copilot", "devin", "windsurf-legacy", "cline"];
    for (const provider of expected) expect(SESSION_RENDER_TOOLS).toContain(provider as SessionRenderTool);
    for (const provider of expected) {
      expect(PROVIDER_CAPABILITY_DESCRIPTORS.some((entry) => entry.provider === provider)).toBe(true);
    }
    expect(selectProviderCapability({ provider: "opencode", provider_version: "1.0.0" }).provider_variant).toBe("v1-instructions");
    expect(selectProviderCapability({ provider: "opencode", provider_version: "2.0.0", provider_variant: "v2-agents" }).session_surface).toBe("opencode-agents-md");
    expect(selectProviderCapability({ provider: "copilot", provider_version: "1.0.0" }).session_surface).toBe("copilot-repository-instructions");
    expect(selectProviderCapability({ provider: "copilot", provider_version: "1.0.0", provider_variant: "path-instructions" }).session_surface).toBe("copilot-path-instructions");
    expect(selectProviderCapability({ provider: "cline", provider_version: "1.0.0" }).provider_variant).toBe("ide");
    expect(selectProviderCapability({ provider: "cline", provider_version: "1.0.0", provider_variant: "cli" }).asset_surface).toBe("cli");
    expect(selectProviderCapability({ provider: "cline", provider_version: "1.0.0", provider_variant: "sdk" }).asset_surface).toBe("cli");
  });

  test("renders Grok Build through repository AGENTS.md", () => {
    const rendered = plan("grok");
    expect(rendered.targetKind).toBe("project-root");
    expect(rendered.files.map((file) => file.relativePath)).toEqual(["AGENTS.md"]);
    expect(rendered.files[0]?.content).toContain("Provider-specific rules.");
    expect(rendered.instructionGraph.capability.asset_surface).toBe("build");
  });

  test("renders Copilot repository-wide and path-specific instructions on distinct surfaces", () => {
    const repository = plan("copilot");
    expect(repository.files.map((file) => file.relativePath)).toEqual([".github/copilot-instructions.md"]);

    const conditional = plan("copilot", {
      providerVariant: "path-instructions",
      activation: { mode: "glob", globs: ["src/**/*.ts"], description: "TypeScript files" },
    });
    expect(conditional.files).toHaveLength(1);
    expect(conditional.files[0]?.relativePath).toBe(".github/instructions/01-copilot-rules.instructions.md");
    expect(conditional.files[0]?.content).toContain('applyTo: "src/**/*.ts"');
    expect(conditional.files[0]?.content).toContain("Provider-specific rules.");
  });

  test("maps current Devin activation modes without writing legacy Windsurf paths", () => {
    const rendered = plan("devin", {
      activation: { mode: "model", models: ["sonnet"], description: "Use when architecture judgment is needed" },
    });
    expect(rendered.files).toHaveLength(1);
    expect(rendered.files[0]?.relativePath).toBe(".devin/rules/01-devin-rules.md");
    expect(rendered.files[0]?.content).toContain("activation: model_decision");
    expect(rendered.files[0]?.content).not.toContain(".windsurf/");
  });

  test("retains the explicit legacy Windsurf fallback as a separate provider", () => {
    const rendered = plan("windsurf-legacy", {
      activation: { mode: "glob", globs: ["web/**"], description: "Web rules" },
    });
    expect(rendered.files[0]?.relativePath).toBe(".windsurf/rules/01-windsurf-legacy-rules.md");
    expect(rendered.files[0]?.content).toContain("activation: glob");
    expect(rendered.files[0]?.content).toContain('globs: ["web/**"]');
  });

  test("renders Cline IDE rules but keeps plugin lifecycle in the asset surface", () => {
    const rendered = plan("cline");
    expect(rendered.files[0]?.relativePath).toBe(".clinerules/01-cline-rules.md");
    expect(rendered.instructionGraph.capability.asset_surface).toBe("ide");
    expect(rendered.assetFiles).toEqual([]);
    expect(rendered.files[0]?.content).toContain("Provider-specific rules.");
  });

  test("blocks project-scoped providers when no repository root is supplied", () => {
    const source = config("rules");
    const rendered = planProfileSessionRender({
      profile_id: "profile-1",
      provider_version: "1.0.0",
      tool: "copilot",
      profile: "profile-1",
      configs: [source],
      bindings: [binding(source.id)],
    });
    expect(rendered.blocked).toBe(true);
    expect(rendered.files).toEqual([]);
    expect(rendered.blockers.join(" ")).toContain("--project-root");
  });
});
