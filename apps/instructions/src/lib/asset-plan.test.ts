import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config, ProfileAssetBinding, ProfileAssetBindingSpec, ProfileConfigBinding } from "../types/index.js";
import { PROFILE_ASSET_BINDING_SCHEMA } from "../types/index.js";
import {
  AssetPlanValidationError,
  assetBundleFromConfig,
  compileAssetPlan,
  configAssetDigest,
  configAssetLocator,
  selectAssetCapability,
} from "./asset-plan.js";
import { legacyProfileConfigBinding, planProfileSessionRender } from "./instruction-graph.js";
import { applySessionRender, restoreSessionRenderSnapshot } from "./session-apply.js";
import { makeTempRoot } from "./test-temp-root.js";

function config(id: string, content: string, version = 3): Config {
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
    version,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    synced_at: null,
  };
}

function binding(
  source: Config,
  overrides: Omit<Partial<ProfileAssetBindingSpec>, "selector" | "source" | "destination"> & {
    selector?: Partial<ProfileAssetBindingSpec["selector"]>;
    source?: Partial<ProfileAssetBindingSpec["source"]>;
    destination?: Partial<ProfileAssetBindingSpec["destination"]>;
  } = {},
  sortOrder = 0,
): ProfileAssetBinding {
  const base: ProfileAssetBindingSpec = {
    schema: PROFILE_ASSET_BINDING_SCHEMA,
    assetKey: "review-skill",
    kind: "skill",
    enabled: true,
    required: true,
    selector: { provider: "grok", versionRange: ">=1.0.0", surface: "build", scope: "project" },
    source: {
      kind: "skill",
      locator: configAssetLocator(source.id, source.version),
      digest: configAssetDigest(source.content),
      immutable: true,
      allowed: true,
    },
    destination: {
      strategy: "emit-file",
      root: "project-root",
      relativePath: ".grok/skills/review/SKILL.md",
    },
    uninstall: "remove-managed",
    rollback: "snapshot",
  };
  return {
    profile_id: "profile-1",
    source_config_id: source.id,
    sort_order: sortOrder,
    binding: {
      ...base,
      ...overrides,
      selector: { ...base.selector, ...overrides.selector },
      source: { ...base.source, ...overrides.source },
      destination: { ...base.destination, ...overrides.destination },
    },
  };
}

function diagnosticsFor(run: () => unknown): string[] {
  try {
    run();
    throw new Error("expected asset validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AssetPlanValidationError);
    return (error as AssetPlanValidationError).diagnostics.map((entry) => entry.code);
  }
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("asset bundle and plan compiler", () => {
  test("content-addresses immutable bundles and produces a deterministic exact-once plan", () => {
    const source = config("skill-source", "# Review skill\n");
    const bundle = assetBundleFromConfig(source, "skill");
    expect(bundle).toMatchObject({
      schema: "hasna.instructions.asset-bundle/v1",
      bundleId: `${configAssetLocator(source.id, source.version)}#skill`,
      locator: configAssetLocator(source.id, source.version),
      digest: configAssetDigest(source.content),
      content: source.content,
    });

    const input = {
      profileId: "profile-1",
      provider: "grok" as const,
      providerVersion: "1.2.0",
      surface: "build",
      scope: "project" as const,
      mode: "dry-run" as const,
      configs: [source],
      bindings: [binding(source)],
    };
    const left = compileAssetPlan(input);
    const right = compileAssetPlan({ ...input, configs: [...input.configs].reverse(), bindings: [...input.bindings].reverse() });
    expect(left).toEqual(right);
    expect(left.assets).toHaveLength(1);
    expect(left.assets[0]).toMatchObject({
      assetId: "profile-1:review-skill",
      kind: "skill",
      support: "supported",
      action: "write",
      mutationMode: "dry-run",
      exactOnceKey: "profile-1|grok|build|project|review-skill",
    });
    expect(Object.isFrozen(left)).toBe(true);
  });

  test("models Cline CLI plugin support separately from the unsupported IDE surface without invoking an installer", () => {
    const source = config("cline-plugin", "export default {};\n");
    const cli = binding(source, {
      assetKey: "cline-plugin",
      kind: "plugin",
      selector: { provider: "cline", versionRange: ">=1.0.0", surface: "cli", scope: "project" },
      source: { kind: "plugin" },
      destination: { strategy: "install-local", root: "project-root", relativePath: ".cline/plugins/example" },
      rollback: "installer-receipt",
    });
    const dryRun = compileAssetPlan({
      profileId: "profile-1",
      provider: "cline",
      providerVersion: "1.0.0",
      surface: "cli",
      scope: "project",
      mode: "dry-run",
      configs: [source],
      bindings: [cli],
    });
    expect(dryRun.assets[0]).toMatchObject({ support: "supported", action: "install" });

    const ide = { ...cli, binding: { ...cli.binding, selector: { ...cli.binding.selector, surface: "ide" } } };
    expect(diagnosticsFor(() => compileAssetPlan({
      profileId: "profile-1",
      provider: "cline",
      providerVersion: "1.0.0",
      surface: "ide",
      scope: "project",
      mode: "apply",
      configs: [source],
      bindings: [ide],
    }))).toContain("ASSET_CAPABILITY_UNSUPPORTED");
  });

  test("models Copilot app plugins separately from repository instructions", () => {
    expect(selectAssetCapability("copilot", "1.0.0", "app", "plugin")).toMatchObject({
      support: "conditional",
      strategies: ["install-marketplace"],
    });
    expect(selectAssetCapability("copilot", "1.0.0", "repository", "plugin")).toMatchObject({
      support: "unsupported",
      strategies: ["unsupported"],
    });
  });

  test("requires explicit installer opt-in in apply plans", () => {
    const source = config("codex-plugin", "plugin bytes\n");
    const row = binding(source, {
      assetKey: "codex-plugin",
      kind: "plugin",
      selector: { provider: "codex", versionRange: ">=0.147.0", surface: "cli", scope: "session" },
      source: { kind: "plugin" },
      destination: { strategy: "install-marketplace", root: "target-home", relativePath: ".plugins/codex-plugin" },
      rollback: "installer-receipt",
    });
    const base = {
      profileId: "profile-1",
      provider: "codex" as const,
      providerVersion: "0.147.0",
      surface: "cli",
      scope: "session" as const,
      mode: "apply" as const,
      configs: [source],
      bindings: [row],
    };
    expect(diagnosticsFor(() => compileAssetPlan(base))).toContain("ASSET_INSTALLER_OPT_IN_REQUIRED");
    expect(compileAssetPlan({ ...base, allowInstallers: true }).assets[0]?.action).toBe("install");
  });

  test("omits optional unsupported assets explicitly", () => {
    const source = config("copilot-plugin", "plugin bytes\n");
    const row = binding(source, {
      assetKey: "copilot-plugin",
      kind: "plugin",
      required: false,
      selector: { provider: "copilot", versionRange: ">=1.0.0", surface: "repository", scope: "project" },
      source: { kind: "plugin" },
      destination: { strategy: "unsupported", root: "project-root", relativePath: ".github/plugins/example" },
      rollback: "none",
    });
    const plan = compileAssetPlan({
      profileId: "profile-1",
      provider: "copilot",
      providerVersion: "1.0.0",
      surface: "repository",
      scope: "project",
      mode: "dry-run",
      configs: [source],
      bindings: [row],
    });
    expect(plan.assets[0]?.action).toBe("skip");
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "ASSET_CAPABILITY_UNSUPPORTED",
      assetKey: "copilot-plugin",
    }));
  });

  test("explains supported mutations without selecting a write or installer action", () => {
    const source = config("explain-skill", "# Explain skill\n");
    const plan = compileAssetPlan({
      profileId: "profile-1",
      provider: "grok",
      providerVersion: "1.0.0",
      surface: "build",
      scope: "project",
      mode: "explain",
      configs: [source],
      bindings: [binding(source, { assetKey: "explain-skill" })],
    });
    expect(plan.assets[0]).toMatchObject({
      action: "explain",
      mutationMode: "explain",
      support: "supported",
    });
  });

  test("fails unsafe, mutable, untrusted, mismatched, colliding, and duplicate assets before materialization", () => {
    const one = config("one", "one\n");
    const two = config("two", "two\n");
    const unsafe = binding(one, {
      destination: { relativePath: "../escape.md" },
      source: { immutable: false, allowed: false, digest: `sha256:${"0".repeat(64)}`, kind: "plugin" },
    });
    const codes = diagnosticsFor(() => compileAssetPlan({
      profileId: "profile-1",
      provider: "grok",
      providerVersion: "1.0.0",
      surface: "build",
      scope: "project",
      mode: "apply",
      configs: [one],
      bindings: [unsafe],
    }));
    expect(codes).toEqual(expect.arrayContaining([
      "ASSET_DESTINATION_UNSAFE",
      "ASSET_SOURCE_MUTABLE_OR_UNPINNED",
      "ASSET_DIGEST_MISMATCH",
      "ASSET_SOURCE_KIND_MISMATCH",
      "ASSET_SOURCE_NOT_ALLOWED",
    ]));

    const first = binding(one, { assetKey: "one", destination: { relativePath: ".grok/shared.md" } });
    const second = binding(two, { assetKey: "two", destination: { relativePath: ".grok/shared.md" } }, 1);
    expect(diagnosticsFor(() => compileAssetPlan({
      profileId: "profile-1",
      provider: "grok",
      providerVersion: "1.0.0",
      surface: "build",
      scope: "project",
      mode: "apply",
      configs: [one, two],
      bindings: [first, second],
    }))).toContain("ASSET_DESTINATION_COLLISION");

    expect(diagnosticsFor(() => compileAssetPlan({
      profileId: "profile-1",
      provider: "grok",
      providerVersion: "1.0.0",
      surface: "build",
      scope: "project",
      mode: "apply",
      configs: [one],
      bindings: [first, { ...first, sort_order: 2 }],
    }))).toContain("ASSET_EXACT_ONCE_DUPLICATE");
  });
});

describe("asset render and apply boundary", () => {
  test("keeps executable assets outside flattened Markdown and restores them through the shared snapshot", () => {
    const root = makeTempRoot("instructions-asset-apply-");
    roots.push(root);
    mkdirSync(root, { recursive: true });
    const instructions = config("instructions", "Keep changes small.\n", 1);
    const skill = config("skill", "# Skill\n\nRun the focused check.\n", 4);
    const graphBinding: ProfileConfigBinding = {
      profile_id: "profile-1",
      config_id: instructions.id,
      sort_order: 0,
      binding: legacyProfileConfigBinding(),
    };
    const firstPlan = planProfileSessionRender({
      profile_id: "profile-1",
      provider_version: "1.0.0",
      tool: "grok",
      profile: "profile-1",
      projectRoot: root,
      generatedAt: "2026-01-01T00:00:00.000Z",
      configs: [instructions],
      bindings: [graphBinding],
      asset_configs: [skill],
      asset_bindings: [binding(skill)],
      asset_plan_mode: "apply",
      asset_scope: "project",
    });
    const firstApply = applySessionRender(firstPlan);
    expect(firstApply.applied).toBe(true);

    const updatedSkill = config("skill", "# Skill\n\nRun the focused check, then inspect the diff.\n", 5);
    const plan = planProfileSessionRender({
      profile_id: "profile-1",
      provider_version: "1.0.0",
      tool: "grok",
      profile: "profile-1",
      projectRoot: root,
      generatedAt: "2026-01-02T00:00:00.000Z",
      configs: [instructions],
      bindings: [graphBinding],
      asset_configs: [updatedSkill],
      asset_bindings: [binding(updatedSkill)],
      asset_plan_mode: "apply",
      asset_scope: "project",
    });
    expect(plan.files.map((file) => file.relativePath)).toEqual(["AGENTS.md"]);
    expect(plan.files[0]?.content).not.toContain("Run the focused check");
    expect(plan.assetFiles).toHaveLength(1);
    expect(plan.assetFiles[0]).toMatchObject({
      relativePath: ".grok/skills/review/SKILL.md",
      role: "asset",
      content: updatedSkill.content,
    });
    expect(plan.manifest.assetPlan?.assets).toHaveLength(1);

    const applied = applySessionRender(plan);
    expect(applied.applied).toBe(true);
    expect(readFileSync(join(root, ".grok", "skills", "review", "SKILL.md"), "utf8")).toBe(updatedSkill.content);
    expect(applied.files).toContainEqual(expect.objectContaining({ role: "asset", action: "update" }));
    expect(applied.snapshotPath).not.toBeNull();

    const restored = restoreSessionRenderSnapshot(applied.snapshotPath!);
    expect(restored.restored).toBe(true);
    expect(readFileSync(join(root, ".grok", "skills", "review", "SKILL.md"), "utf8")).toBe(skill.content);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  });

  test("dry-run performs no writes and required unsupported assets fail before prompt files exist", () => {
    const root = makeTempRoot("instructions-asset-dry-run-");
    roots.push(root);
    mkdirSync(root, { recursive: true });
    const instructions = config("instructions", "Rules\n", 1);
    const plugin = config("plugin", "plugin\n", 1);
    const graphBinding: ProfileConfigBinding = {
      profile_id: "profile-1",
      config_id: instructions.id,
      sort_order: 0,
      binding: legacyProfileConfigBinding(),
    };
    const unsupported = binding(plugin, {
      assetKey: "copilot-plugin",
      kind: "plugin",
      selector: { provider: "copilot", versionRange: ">=1.0.0", surface: "repository", scope: "project" },
      source: { kind: "plugin" },
      destination: { strategy: "unsupported", root: "project-root", relativePath: ".github/plugins/example" },
      rollback: "none",
    });
    expect(() => planProfileSessionRender({
      profile_id: "profile-1",
      provider_version: "1.0.0",
      tool: "copilot",
      profile: "profile-1",
      projectRoot: root,
      configs: [instructions],
      bindings: [graphBinding],
      asset_configs: [plugin],
      asset_bindings: [unsupported],
      asset_plan_mode: "dry-run",
      asset_scope: "project",
    })).toThrow(AssetPlanValidationError);
    expect(existsSync(join(root, ".github", "copilot-instructions.md"))).toBe(false);
    expect(existsSync(join(root, ".hasna"))).toBe(false);
  });

  test("refuses installer actions before any prompt or asset write", () => {
    const root = makeTempRoot("instructions-asset-installer-refusal-");
    roots.push(root);
    mkdirSync(root, { recursive: true });
    const instructions = config("instructions", "Rules\n", 1);
    const plugin = config("plugin", "plugin\n", 1);
    const graphBinding: ProfileConfigBinding = {
      profile_id: "profile-1",
      config_id: instructions.id,
      sort_order: 0,
      binding: legacyProfileConfigBinding(),
    };
    const pluginBinding = binding(plugin, {
      assetKey: "cline-plugin",
      kind: "plugin",
      selector: { provider: "cline", versionRange: ">=1.0.0", surface: "cli", scope: "project" },
      source: { kind: "plugin" },
      destination: { strategy: "install-local", root: "project-root", relativePath: ".cline/plugins/example" },
      rollback: "installer-receipt",
    });
    const plan = planProfileSessionRender({
      profile_id: "profile-1",
      provider_version: "1.0.0",
      tool: "cline",
      profile: "profile-1",
      projectRoot: root,
      configs: [instructions],
      bindings: [graphBinding],
      asset_configs: [plugin],
      asset_bindings: [pluginBinding],
      asset_plan_mode: "apply",
      asset_scope: "project",
      asset_surface: "cli",
      allow_asset_installers: true,
    });

    expect(plan.assetPlan?.assets[0]).toMatchObject({ action: "install", assetKey: "cline-plugin" });
    expect(() => applySessionRender(plan)).toThrow("Asset installer execution is not available in this release");
    expect(existsSync(join(root, ".clinerules"))).toBe(false);
    expect(existsSync(join(root, ".hasna"))).toBe(false);
  });
});
