import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GLOBAL_AGENT_RULES_STANDARD_CONTENT } from "../lib/global-agent-rules-standard";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_INSTRUCTIONS_API_URL: "",
      HASNA_INSTRUCTIONS_API_KEY: "",
      ...env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

describe("configs session CLI", () => {
  test("help lists accepted source layers and aliases", () => {
    const result = runCli(["session", "plan", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("global|provider|tool|account|machine|division|workspace|project|repo|path|identity|agent|session|local");
    expect(result.stdout).toContain("--project-root");
    expect(result.stdout).toContain("--codewith-native-imports");
    expect(result.stdout).toContain("--allow-empty-sources");
  });

  test("selects the gated Codewith native-import adapter from session CLI", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      mkdirSync(join(home, "sources"), { recursive: true });
      writeFileSync(join(home, "sources", "global.md"), "Global native-import source");
      const result = runCli([
        "session",
        "plan",
        "--tool",
        "codewith",
        "--profile",
        "account999",
        "--target-home",
        "~/codewith-home",
        "--source",
        "global:global-cli=~/sources/global.md",
        "--codewith-native-imports",
        "--json",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
        HASNA_CONFIGS_CODEWITH_NATIVE_IMPORTS: undefined,
      });

      expect(result.status).toBe(0);
      const plan = JSON.parse(result.stdout) as { adapter: { mode: string }; manifest: { adapterMode: string } };
      expect(plan.adapter.mode).toBe("native-imports");
      expect(plan.manifest.adapterMode).toBe("native-imports");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("fails closed when no sources are provided unless explicitly allowed", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const env = {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      };
      const failed = runCli([
        "session",
        "plan",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--json",
      ], env);
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain("no instruction sources");

      const allowed = runCli([
        "session",
        "plan",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--allow-empty-sources",
        "--json",
      ], env);
      expect(allowed.status).toBe(0);
      const plan = JSON.parse(allowed.stdout) as { warnings: string[] };
      expect(plan.warnings).toContain("No instruction sources were provided.");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("exits non-zero when the render plan is blocked instead of returning a silent empty plan", () => {
    // Regression for todos 1a3e8689: with an unmanaged fixed global authority
    // present, `session plan --tool cursor` returned rc=0 with files: [] — a
    // plausible-zero that automation reads as "nothing to render" while the
    // render is actually blocked.
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      mkdirSync(join(home, ".cursor", "rules"), { recursive: true });
      writeFileSync(join(home, ".cursor", "rules", "hasna-global.mdc"), "# Foreign global rule\n");
      mkdirSync(join(home, "sources"), { recursive: true });
      writeFileSync(join(home, "sources", "global.md"), "Global CLI source");

      const result = runCli([
        "session",
        "plan",
        "--tool",
        "cursor",
        "--profile",
        "account999",
        "--project-root",
        join(home, "repo"),
        "--source",
        "global:global-cli=~/sources/global.md",
        "--json",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(1);
      const plan = JSON.parse(result.stdout) as { blocked: boolean; blockers: string[]; files: unknown[] };
      expect(plan.blocked).toBe(true);
      expect(plan.blockers.join(" ")).toContain(".cursor/rules/hasna-global.mdc");
      expect(plan.files).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("expands quoted source and target paths before planning", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      mkdirSync(join(home, "sources"), { recursive: true });
      writeFileSync(join(home, "sources", "global.md"), "Global CLI source");

      const result = runCli([
        "session",
        "plan",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--target-home",
        '"~/session-home"',
        "--source",
        'global:global-cli="~/sources/global.md"',
        "--json",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(0);
      const plan = JSON.parse(result.stdout) as {
        targetHome: string;
        manifest: { sources: Array<{ path: string | null }> };
      };
      expect(plan.targetHome).toBe(join(home, "session-home"));
      expect(plan.manifest.sources[0]?.path).toBe(join(home, "sources", "global.md"));
      expect(result.stdout).not.toContain("Global CLI source");
      expect(plan).not.toHaveProperty("files.0.content");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("applies session files only outside dry-run", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      mkdirSync(join(home, "sources"), { recursive: true });
      writeFileSync(join(home, "sources", "global.md"), "Global CLI apply source");
      const env = {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      };

      const dryRun = runCli([
        "session",
        "apply",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--target-home",
        "~/session-home",
        "--source",
        "global:global-cli=~/sources/global.md",
        "--dry-run",
        "--json",
      ], env);

      expect(dryRun.status).toBe(0);
      expect(existsSync(join(home, "session-home", "AGENTS.md"))).toBe(false);
      const dryRunResult = JSON.parse(dryRun.stdout) as { warnings: string[]; skippedSources: unknown[] };
      expect(dryRunResult.warnings).toEqual([]);
      expect(dryRunResult.skippedSources).toEqual([]);

      const apply = runCli([
        "session",
        "apply",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--target-home",
        "~/session-home",
        "--source",
        "global:global-cli=~/sources/global.md",
        "--json",
      ], env);

      expect(apply.status).toBe(0);
      expect(readFileSync(join(home, "session-home", "AGENTS.md"), "utf-8")).toContain("Global CLI apply source");
      const result = JSON.parse(apply.stdout) as { applied: boolean; conflicts: unknown[] };
      expect(result.applied).toBe(true);
      expect(result.conflicts).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("restores an unchanged applied snapshot through the session CLI", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const sourcePath = join(home, "global.md");
      const targetHome = join(home, "session-home");
      const env = {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      };
      writeFileSync(sourcePath, "Original CLI source");
      const applyArgs = [
        "session",
        "apply",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--target-home",
        targetHome,
        "--source",
        `global:global-cli=${sourcePath}`,
        "--json",
      ];
      expect(runCli(applyArgs, env).status).toBe(0);

      writeFileSync(sourcePath, "Updated CLI source");
      const update = runCli(applyArgs, env);
      expect(update.status).toBe(0);
      const updateResult = JSON.parse(update.stdout) as { snapshotPath: string | null };
      expect(updateResult.snapshotPath).not.toBeNull();
      expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toContain("Updated CLI source");

      const preview = runCli([
        "session",
        "restore",
        updateResult.snapshotPath!,
        "--dry-run",
        "--json",
      ], env);
      expect(preview.status).toBe(0);
      expect((JSON.parse(preview.stdout) as { restored: boolean }).restored).toBe(false);
      expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toContain("Updated CLI source");

      const restore = runCli([
        "session",
        "restore",
        updateResult.snapshotPath!,
        "--json",
      ], env);
      expect(restore.status).toBe(0);
      expect((JSON.parse(restore.stdout) as { restored: boolean }).restored).toBe(true);
      expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toContain("Original CLI source");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("loads OpenIdentities configs exports and provider layer aliases", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const exportPath = join(home, "instructions.json");
      writeFileSync(exportPath, JSON.stringify({
        contract: "hasna.identities.configs-instructions/v1",
        validation: { valid: true },
        sources: [
          {
            id: "provider-codewith",
            label: "Provider Codewith",
            layer: "tool",
            merge: "append",
            order: 200,
            content: "Codewith provider rules.",
            targetProviders: ["codewith"],
          },
          {
            id: "claude-only",
            label: "Claude Only",
            layer: "tool",
            merge: "append",
            order: 201,
            content: "Claude only.",
            targetProviders: ["claude"],
          },
        ],
      }));
      mkdirSync(join(home, "sources"), { recursive: true });
      writeFileSync(join(home, "sources", "project.md"), "Project CLI source");

      const result = runCli([
        "session",
        "plan",
        "--tool",
        "codewith",
        "--profile",
        "account999",
        "--target-home",
        "~/codewith-home",
        "--identity-export",
        exportPath,
        "--source",
        "project:project-cli=~/sources/project.md",
        "--json",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(0);
      const plan = JSON.parse(result.stdout) as { manifest: { sources: Array<{ id: string; layer: string }> } };
      expect(plan.manifest.sources.map((source) => source.id)).toEqual(["provider-codewith", "project-cli"]);
      expect(plan.manifest.sources.map((source) => source.layer)).toEqual(["tool", "repo"]);
      expect(result.stdout).not.toContain("Claude only.");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("--replace-source replacer=target matches identity-exported replacementScope", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const cliScopedExport = join(home, "cli-scoped.json");
      const identityScopedExport = join(home, "identity-scoped.json");
      const sources = [
        {
          id: "shared-review",
          title: "Shared Review",
          kind: "global-rules",
          precedence: 0,
          mergePolicy: "append",
          content: "Shared review requires two reviewers.",
        },
        {
          id: "r11-recording",
          title: "R11 Recording",
          kind: "global-rules",
          precedence: 1,
          mergePolicy: "append",
          content: "R11 remains.",
        },
        {
          id: "codewith-review",
          title: "Codewith Review",
          kind: "global-rules",
          precedence: 2,
          mergePolicy: "append",
          content: "Codewith review requires one reviewer.",
        },
      ];
      const exportPayload = (scoped: boolean) => ({
        contract: "hasna.identities.configs-instructions/v1",
        validation: { valid: true },
        sources: sources.map((source) =>
          source.id === "codewith-review" && scoped
            ? {
              ...source,
              mergePolicy: "replace",
              replacementScope: "source:shared-review",
            }
            : source
        ),
      });
      writeFileSync(cliScopedExport, JSON.stringify(exportPayload(false)));
      writeFileSync(identityScopedExport, JSON.stringify(exportPayload(true)));
      const env = {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      };
      const common = [
        "session",
        "plan",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--target-home",
        "~/session-home",
        "--json",
      ];

      const fromCli = runCli([
        ...common,
        "--identity-export",
        cliScopedExport,
        "--replace-source",
        "codewith-review=Shared Review",
      ], env);
      const fromIdentity = runCli([
        ...common,
        "--identity-export",
        identityScopedExport,
      ], env);

      expect(fromCli.status).toBe(0);
      expect(fromIdentity.status).toBe(0);
      const cliPlan = JSON.parse(fromCli.stdout) as {
        manifest: {
          sourceHash: string;
          sources: Array<{ id: string; replacementScope: string | null; provenance: unknown }>;
          skippedSources: Array<{ id: string; reason: string }>;
        };
      };
      const identityPlan = JSON.parse(fromIdentity.stdout) as typeof cliPlan;
      expect(cliPlan.manifest.sourceHash).toBe(identityPlan.manifest.sourceHash);
      expect(cliPlan.manifest.sources).toEqual(identityPlan.manifest.sources);
      expect(cliPlan.manifest.skippedSources).toEqual(identityPlan.manifest.skippedSources);
      expect(cliPlan.manifest.sources.map((source) => source.id)).toEqual([
        "r11-recording",
        "codewith-review",
      ]);
      expect(cliPlan.manifest.sources[1]?.replacementScope).toBe("source:shared-review");
      expect(cliPlan.manifest.skippedSources.map((source) => source.id)).toEqual(["shared-review"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("--replace-source replacer keeps broad replacement compatibility", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const exportPath = join(home, "broad-replace.json");
      writeFileSync(exportPath, JSON.stringify({
        contract: "hasna.identities.configs-instructions/v1",
        validation: { valid: true },
        sources: [
          {
            id: "ordinary-a",
            title: "Ordinary A",
            kind: "global-rules",
            precedence: 0,
            mergePolicy: "append",
            content: "Ordinary A.",
          },
          {
            id: "ordinary-b",
            title: "Ordinary B",
            kind: "global-rules",
            precedence: 1,
            mergePolicy: "append",
            content: "Ordinary B.",
          },
          {
            id: "broad-replacer",
            title: "Broad Replacer",
            kind: "global-rules",
            precedence: 2,
            mergePolicy: "append",
            content: "Broad replacement.",
          },
        ],
      }));

      const result = runCli([
        "session",
        "plan",
        "--tool",
        "codex",
        "--profile",
        "account999",
        "--identity-export",
        exportPath,
        "--replace-source",
        "broad-replacer",
        "--json",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(0);
      const plan = JSON.parse(result.stdout) as {
        manifest: {
          sources: Array<{ id: string; replacementScope: string | null }>;
          skippedSources: Array<{ id: string }>;
        };
      };
      expect(plan.manifest.sources).toEqual([
        expect.objectContaining({ id: "broad-replacer", replacementScope: null }),
      ]);
      expect(plan.manifest.skippedSources.map((source) => source.id)).toEqual(["ordinary-a", "ordinary-b"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("applies canonical identity exports with source paths and filters rule provider blocks", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const exportDir = join(home, "identity-export");
      mkdirSync(join(exportDir, "providers"), { recursive: true });
      writeFileSync(join(exportDir, "providers", "codewith.md"), "CLI resolved path-only Codewith rules.");
      const exportPath = join(exportDir, "instructions.json");
      writeFileSync(exportPath, JSON.stringify({
        version: 1,
        package: "@hasna/identities",
        exportedAt: "2026-07-01T00:00:00.000Z",
        sources: [
          {
            id: "canonical-path-only-codewith",
            kind: "provider-rules",
            title: "Canonical Path Only Codewith",
            owner: { kind: "provider", id: "codewith" },
            sensitivity: "internal",
            precedence: 200,
            mergePolicy: "append",
            safety: "standard",
            nonOverridable: false,
            ruleIds: ["rule:provider-filter"],
            targetProviders: ["codewith"],
            providerCompatibility: [],
            sourcePaths: [{ path: "providers/codewith.md", editable: true, required: true }],
            globs: [],
            hash: "sha256:canonical-path",
            provenance: { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" },
            metadata: {},
            rules: [
              {
                id: "rule:provider-filter",
                path: "rules/provider-filter.md",
                content: [
                  "CLI shared provider-filter rule.",
                  "<!-- @hasna-provider: claude -->",
                  "CLI Claude-only rule leak.",
                  "<!-- @hasna-end-provider -->",
                  "<!-- @hasna-provider: codewith -->",
                  "CLI Codewith-only rule.",
                  "<!-- @hasna-end-provider -->",
                ].join("\n"),
              },
            ],
          },
        ],
        validation: { valid: true, sourceCount: 1, issues: [], effectiveHash: "sha256:canonical", nonOverridableSafetyRules: [] },
        metadata: {},
      }));

      const result = runCli([
        "session",
        "apply",
        "--tool",
        "codewith",
        "--profile",
        "account999",
        "--target-home",
        "~/codewith-home",
        "--identity-export",
        exportPath,
        "--json",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(0);
      const rendered = readFileSync(join(home, "codewith-home", "CODEWITH.md"), "utf-8");
      expect(rendered).toContain("CLI resolved path-only Codewith rules.");
      expect(rendered).toContain("CLI Codewith-only rule.");
      expect(rendered).not.toContain("CLI Claude-only rule leak.");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("deduplicates one semantic policy across config and identity-export transports", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const dbPath = join(home, "instructions.db");
      const env = {
        HOME: home,
        CONFIGS_HOME: home,
        HASNA_INSTRUCTIONS_DB_PATH: dbPath,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      };
      const configPath = join(home, "global-agent-rules-standard.md");
      writeFileSync(configPath, GLOBAL_AGENT_RULES_STANDARD_CONTENT);
      const added = runCli([
        "add",
        configPath,
        "--name",
        "Global Agent Rules Standard",
        "--category",
        "rules",
        "--agent",
        "global",
        "--kind",
        "reference",
      ], env);
      expect(added.status).toBe(0);

      const exportPath = join(home, "identity-export.json");
      writeFileSync(exportPath, JSON.stringify({
        contract: "hasna.identities.configs-instructions/v1",
        sources: [{
          id: "identity-agent-operating-rules",
          label: "Identity Agent Operating Rules",
          layer: "global",
          merge: "append",
          order: 1,
          content: GLOBAL_AGENT_RULES_STANDARD_CONTENT,
          targetProviders: ["codewith"],
          nonOverridable: true,
          metadata: { role: "agent-operating-rules", rulesVersion: "1.1.26" },
        }],
        validation: { valid: true },
      }));

      const applyArgs = [
        "session",
        "apply",
        "--tool",
        "codewith",
        "--profile",
        "account999",
        "--target-home",
        "~/codewith-home",
        "--config",
        "global:global-agent-rules-standard",
        "--identity-export",
        exportPath,
      ];

      const dryRun = runCli([...applyArgs, "--dry-run", "--json"], env);
      expect(dryRun.status).toBe(0);
      const dryRunResult = JSON.parse(dryRun.stdout) as {
        warnings: string[];
        skippedSources: Array<{ id: string; reason: string }>;
      };
      expect(dryRunResult.skippedSources.map((source) => source.id)).toEqual(["identity-agent-operating-rules"]);
      expect(dryRunResult.warnings.some((warning) => warning.includes("identity-agent-operating-rules"))).toBe(true);

      const humanDryRun = runCli([...applyArgs, "--dry-run"], env);
      expect(humanDryRun.status).toBe(0);
      expect(humanDryRun.stdout).toContain('warning: Instruction source "identity-agent-operating-rules" was not rendered');

      const result = runCli([...applyArgs, "--json"], env);

      expect(result.status).toBe(0);
      const applied = JSON.parse(result.stdout) as {
        manifestPath: string;
        warnings: string[];
        skippedSources: Array<{ id: string }>;
      };
      expect(applied.skippedSources.map((source) => source.id)).toEqual(["identity-agent-operating-rules"]);
      expect(applied.warnings.some((warning) => warning.includes("identity-agent-operating-rules"))).toBe(true);
      const manifest = JSON.parse(readFileSync(applied.manifestPath, "utf8")) as {
        sources: Array<{ id: string }>;
      };
      const rendered = readFileSync(join(home, "codewith-home", "CODEWITH.md"), "utf8");
      expect(manifest.sources).toHaveLength(1);
      expect((rendered.match(/hasna:agent-operating-rules v=1\.1\.26/g) ?? [])).toHaveLength(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("session plan WITHOUT --target-home shows profile home as target", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      mkdirSync(join(home, "sources"), { recursive: true });
      writeFileSync(join(home, "sources", "global.md"), "# Global Plan Test\n\nPlan test content.");
      
      const result = runCli([
        "session",
        "plan",
        "--tool",
        "codex",
        "--profile",
        "plan-test",
        "--source",
        "global:global-plan=~/sources/global.md",
        "--json",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(0);
      
      const plan = JSON.parse(result.stdout) as { targetHome: string };
      const expectedProfileHome = join(home, ".hasna", "accounts", "profiles", "codex", "plan-test");
      
      expect(plan.targetHome).toBe(expectedProfileHome);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("session apply WITHOUT --target-home writes to profile home", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      mkdirSync(join(home, "sources"), { recursive: true });
      writeFileSync(join(home, "sources", "global.md"), "# Global Test\n\nThis is the global test content.");
      
      const result = runCli([
        "session",
        "apply",
        "--tool",
        "claude",
        "--profile",
        "test-profile",
        "--source",
        "global:global-test=~/sources/global.md",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(0);
      
      const profileHome = join(home, ".hasna", "accounts", "profiles", "claude", "test-profile");
      const sessionHome = join(home, ".hasna", "configs", "sessions", "claude", "test-profile", "latest");
      
      // Files should be in profile home, not session home
      expect(existsSync(join(profileHome, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(profileHome, ".hasna", "session-render-manifest.json"))).toBe(true);
      
      // Files should NOT be in the old session home location
      expect(existsSync(sessionHome)).toBe(false);
      
      const rendered = readFileSync(join(profileHome, "CLAUDE.md"), "utf8");
      expect(rendered).toContain("@./.hasna/instructions/01-global-test.md");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("session apply WITH --target-home writes to specified directory", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      mkdirSync(join(home, "sources"), { recursive: true });
      mkdirSync(join(home, "custom-target"), { recursive: true });
      writeFileSync(join(home, "sources", "global.md"), "# Global Custom\n\nCustom target content.");
      
      const customTarget = join(home, "custom-target");
      const result = runCli([
        "session",
        "apply",
        "--tool",
        "claude",
        "--profile",
        "test-profile",
        "--target-home",
        customTarget,
        "--source",
        "global:global-custom=~/sources/global.md",
      ], {
        HOME: home,
        HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"),
      });

      expect(result.status).toBe(0);
      
      // Files should be in custom target
      expect(existsSync(join(customTarget, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(customTarget, ".hasna", "session-render-manifest.json"))).toBe(true);
      
      const rendered = readFileSync(join(customTarget, "CLAUDE.md"), "utf8");
      expect(rendered).toContain("@./.hasna/instructions/01-global-custom.md");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("configs session CLI -- global-source coverage gate (O15-00694)", () => {
  // Regression for incident 736344 (todos O15-00694): 16 registered global-* sources
  // reached no render on station01 because the hand-maintained RENDER-SPEC.sh
  // GLOBAL_CONFIGS array never listed them, and `--check-global-coverage` was
  // warn-only at rc=0 — the render path stayed silent, exactly the deletion-trap
  // class global-source-coverage.ts documents ("a source that is simply never added
  // to the array disappears from every render, silently, at rc=0, forever").
  //
  // The gate must FAIL the render (plan: non-zero exit; apply: refuse to write) when a
  // registered, non-retired global-* source is absent from the --config list, so a gap
  // is loud instead of silent. Constructed shortfall: seed one stored config with a
  // global- slug, then render WITHOUT wiring it.

  const sourceBody = "# Global fix-lane regression source\n\nBody for the coverage gate test.\n";

  function seedGlobalConfig(home: string, env: Record<string, string | undefined>): void {
    mkdirSync(join(home, "sources"), { recursive: true });
    const sourcePath = join(home, "sources", "global-fix-lane-regression.md");
    writeFileSync(sourcePath, sourceBody);
    const seeded = runCli(["add", sourcePath, "--name", "global-fix-lane-regression", "--category", "agent", "--agent", "global"], env);
    const list = runCli(["list", "--json"], env);
    expect(
      seeded.status,
      `add stdout: ${seeded.stdout} | add stderr: ${seeded.stderr} | list stdout: ${list.stdout} | list stderr: ${list.stderr}`,
    ).toBe(0);
  }

  test("plan exits non-zero and reports the missing slug when a registered global-* source is absent (constructed shortfall)", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const env = { HOME: home, HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"), HASNA_INSTRUCTIONS_DB_PATH: join(home, "instructions.db") };
      seedGlobalConfig(home, env);

      const result = runCli([
        "session", "plan",
        "--tool", "codex",
        "--profile", "account999",
        "--target-home", join(home, "codex-home"),
        "--allow-empty-sources",
        "--check-global-coverage",
        "--json",
      ], env);

      expect(result.status, `plan stdout: ${result.stdout} | plan stderr: ${result.stderr}`).toBe(1);
      const planA = JSON.parse(result.stdout) as {
        globalSourceCoverage: { complete: boolean; expectedSlugs: string[]; missingSlugs: string[] };
      };
      expect(planA.globalSourceCoverage.complete).toBe(false);
      expect(planA.globalSourceCoverage.expectedSlugs).toContain("global-fix-lane-regression");
      expect(planA.globalSourceCoverage.missingSlugs).toContain("global-fix-lane-regression");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("plan exits 0 when every registered global-* source is wired into the render", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const env = { HOME: home, HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"), HASNA_INSTRUCTIONS_DB_PATH: join(home, "instructions.db") };
      seedGlobalConfig(home, env);

      const result = runCli([
        "session", "plan",
        "--tool", "codex",
        "--profile", "account999",
        "--target-home", join(home, "codex-home"),
        "--config", "global:global-fix-lane-regression",
        "--check-global-coverage",
        "--json",
      ], env);

      expect(result.status, `plan stdout: ${result.stdout} | plan stderr: ${result.stderr}`).toBe(0);
      const planB = JSON.parse(result.stdout) as { globalSourceCoverage: { complete: boolean; missingSlugs: string[] } };
      expect(planB.globalSourceCoverage.complete).toBe(true);
      expect(planB.globalSourceCoverage.missingSlugs).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("apply refuses to write (status 1, no render) when coverage is incomplete; applies when complete", () => {
    const home = makeTempRoot("open-configs-session-cli-");
    try {
      const env = { HOME: home, HASNA_CONFIGS_HOME: join(home, ".hasna", "configs"), HASNA_INSTRUCTIONS_DB_PATH: join(home, "instructions.db") };
      seedGlobalConfig(home, env);
      const codexHome = join(home, "codex-home");

      const refused = runCli([
        "session", "apply",
        "--tool", "codex",
        "--profile", "account999",
        "--target-home", codexHome,
        "--allow-empty-sources",
        "--check-global-coverage",
        "--json",
      ], env);

      expect(refused.status, `apply stdout: ${refused.stdout} | apply stderr: ${refused.stderr}`).toBe(1);
      expect(existsSync(join(codexHome, ".hasna", "session-render-manifest.json"))).toBe(false);

      const applied = runCli([
        "session", "apply",
        "--tool", "codex",
        "--profile", "account999",
        "--target-home", codexHome,
        "--config", "global:global-fix-lane-regression",
        "--check-global-coverage",
        "--json",
      ], env);

      expect(applied.status, `apply stdout: ${applied.stdout} | apply stderr: ${applied.stderr}`).toBe(0);
      expect(existsSync(join(codexHome, ".hasna", "session-render-manifest.json"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
