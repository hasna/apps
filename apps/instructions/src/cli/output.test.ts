import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createConfig } from "../db/configs";
import { getDatabase, resetDatabase } from "../db/database";
import { addConfigToProfile, createProfile } from "../db/profiles";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs: string[] = [];

function runCli(args: string[], dbPath: string, home?: string) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_INSTRUCTIONS_DB_PATH: dbPath,
      HASNA_INSTRUCTIONS_LOCAL: "1",
      HASNA_INSTRUCTIONS_API_URL: "",
      HASNA_INSTRUCTIONS_API_KEY: "",
      ...(home ? { HOME: home, CONFIGS_HOME: home } : {}),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

function seedConfigs(count: number, contentBytes = 400, nameBytes = 0): { home: string; dbPath: string } {
  const home = makeTempRoot("open-configs-output-cli-");
  tempDirs.push(home);
  const dbPath = join(home, "configs.db");
  process.env["HASNA_INSTRUCTIONS_DB_PATH"] = dbPath;
  resetDatabase();
  const db = getDatabase(dbPath);
  for (let i = 1; i <= count; i++) {
    createConfig({
      name: nameBytes > 0 ? `Config ${i} ${"n".repeat(nameBytes)}` : `Very Long Agent Config ${String(i).padStart(2, "0")}`,
      category: i % 2 === 0 ? "agent" : "rules",
      agent: i % 3 === 0 ? "codex" : "claude",
      kind: "file",
      target_path: `~/.config/very/deep/path/that/keeps/going/agent-${i}/settings-with-a-long-name.json`,
      format: "json",
      content: `CONTENT_CANARY_DO_NOT_LEAK_${i}:` + "x".repeat(contentBytes),
      description: "This description is intentionally long and repetitive so the default output would be noisy.",
      tags: ["long", "sample", `item-${i}`],
      outputs: [{ agent: "codewith", target_path: `~/.codewith/generated/agent-${i}/CODEWITH.md`, transform: "codex-flat" }],
    }, db);
  }
  resetDatabase();
  delete process.env["HASNA_INSTRUCTIONS_DB_PATH"];
  return { home, dbPath };
}

afterEach(() => {
  resetDatabase();
  delete process.env["HASNA_INSTRUCTIONS_DB_PATH"];
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("configs list output", () => {
  test("defaults to compact paged output", () => {
    const { dbPath } = seedConfigs(25);
    const result = runCli(["list"], dbPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Showing 20 of 25");
    expect(result.stdout).toContain("Next: configs list --cursor 20 --limit 20");
    expect(result.stdout).toContain("configs show <slug>");
    expect(result.stdout).not.toContain("intentionally long and repetitive");
    expect(result.stdout.split("\n").filter(Boolean).length).toBeLessThanOrEqual(25);
  });

  test("verbose output discloses expanded metadata only when requested", () => {
    const { dbPath } = seedConfigs(3);
    const result = runCli(["list", "--verbose", "--limit", "1"], dbPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Very Long Agent Config");
    expect(result.stdout).toContain("intentionally long and repetitive");
    expect(result.stdout).toContain("Showing 1 of 3");
  });

  test("ordinary json defaults to a minified 20-row identity page with truthful continuation", () => {
    const { dbPath } = seedConfigs(25);
    const result = runCli(["list", "--json"], dbPath);

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const payload = JSON.parse(result.stdout) as {
      configs: Array<Record<string, unknown>>;
      _meta: Record<string, unknown>;
    };
    expect(payload.configs).toHaveLength(20);
    expect(payload._meta).toMatchObject({
      count: 20,
      total: 25,
      limit: 20,
      cursor: 0,
      next_cursor: 20,
      has_more: true,
      complete: false,
      truncated: true,
      truncation_reason: "limit",
      detail: "compact",
      source_bounded: true,
    });
    expect(payload.configs.every((config) => !(
      "content" in config || "target_path" in config || "outputs" in config || "description" in config || "tags" in config
    ))).toBe(true);
    expect(result.stdout).not.toContain("CONTENT_CANARY_DO_NOT_LEAK");
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(32 * 1024);
  });

  test("100 configs with 10 KiB content stay deterministic, paged, and below 32 KiB", () => {
    const { dbPath } = seedConfigs(100, 10 * 1024);
    const first = runCli(["list", "--json"], dbPath);
    const repeated = runCli(["list", "--json"], dbPath);
    const second = runCli(["list", "--json", "--cursor", "20"], dbPath);

    expect(first.status).toBe(0);
    expect(repeated.status).toBe(0);
    expect(second.status).toBe(0);
    expect(repeated.stdout).toBe(first.stdout);
    expect(Buffer.byteLength(first.stdout, "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(Buffer.byteLength(second.stdout, "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(first.stdout.trim().split("\n")).toHaveLength(1);
    expect(first.stdout).not.toContain("CONTENT_CANARY_DO_NOT_LEAK");

    const firstPage = JSON.parse(first.stdout) as { configs: Array<{ id: string }>; _meta: Record<string, unknown> };
    const secondPage = JSON.parse(second.stdout) as { configs: Array<{ id: string }>; _meta: Record<string, unknown> };
    expect(firstPage.configs).toHaveLength(20);
    expect(secondPage.configs).toHaveLength(20);
    expect(firstPage._meta).toMatchObject({ total: 100, cursor: 0, next_cursor: 20, has_more: true });
    expect(secondPage._meta).toMatchObject({ total: 100, cursor: 20, next_cursor: 40, has_more: true });
    expect(new Set([...firstPage.configs, ...secondPage.configs].map((config) => config.id)).size).toBe(40);
  });

  test("byte clipping advances from the last emitted identity without exceeding 32 KiB", () => {
    const { dbPath } = seedConfigs(12, 400, 3_000);
    const first = runCli(["list", "--json"], dbPath);

    expect(first.status).toBe(0);
    expect(Buffer.byteLength(first.stdout, "utf8")).toBeLessThanOrEqual(32 * 1024);
    const firstPage = JSON.parse(first.stdout) as { configs: Array<{ id: string }>; _meta: Record<string, unknown> };
    const nextCursor = Number(firstPage._meta.next_cursor);
    expect(firstPage.configs.length).toBeGreaterThan(0);
    expect(firstPage.configs.length).toBeLessThan(12);
    expect(nextCursor).toBe(firstPage.configs.length);
    expect(firstPage._meta).toMatchObject({
      total: 12,
      cursor: 0,
      has_more: true,
      complete: false,
      truncated: true,
      truncation_reason: "max_bytes",
    });

    const second = runCli(["list", "--json", "--cursor", String(nextCursor)], dbPath);
    expect(second.status).toBe(0);
    expect(Buffer.byteLength(second.stdout, "utf8")).toBeLessThanOrEqual(32 * 1024);
    const secondPage = JSON.parse(second.stdout) as { configs: Array<{ id: string }>; _meta: Record<string, unknown> };
    expect(secondPage._meta.cursor).toBe(nextCursor);
    expect(new Set([...firstPage.configs, ...secondPage.configs].map((config) => config.id)).size)
      .toBe(firstPage.configs.length + secondPage.configs.length);
  });

  test("explicit --full preserves the historical complete full-record array", () => {
    const { dbPath } = seedConfigs(4);
    const result = runCli(["list", "--full"], dbPath);

    expect(result.status).toBe(0);
    const records = JSON.parse(result.stdout) as Array<{ content: string; outputs: unknown[] }>;
    expect(records).toHaveLength(4);
    expect(records[0]?.content).toContain("CONTENT_CANARY_DO_NOT_LEAK");
    expect(records[0]?.outputs).toHaveLength(1);
  });

  test("explicit --full array honors limit and cursor", () => {
    const { dbPath } = seedConfigs(6);
    const result = runCli(["list", "--json", "--full", "--limit", "2", "--cursor", "1"], dbPath);

    expect(result.status).toBe(0);
    const records = JSON.parse(result.stdout) as Array<{ content: string }>;
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.content.includes("CONTENT_CANARY_DO_NOT_LEAK"))).toBe(true);
  });

  test("compact detail is bounded, minified, truthful, and omits config content", () => {
    const { dbPath } = seedConfigs(25);
    const result = runCli(["list", "--json", "--detail", "compact", "--limit", "5"] , dbPath);

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const payload = JSON.parse(result.stdout) as {
      configs: Array<Record<string, unknown>>;
      _meta: Record<string, unknown>;
    };
    expect(payload.configs).toHaveLength(5);
    expect(payload._meta).toMatchObject({
      count: 5,
      total: 25,
      limit: 5,
      cursor: 0,
      next_cursor: 5,
      has_more: true,
      complete: false,
      truncated: true,
      truncation_reason: "limit",
      detail: "compact",
      source_bounded: true,
    });
    expect(payload.configs.every((config) => !("content" in config))).toBe(true);
    expect(result.stdout).not.toContain("CONTENT_CANARY_DO_NOT_LEAK");
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(8_000);
  });

  test("compact fields provide an identity projection without hidden extras", () => {
    const { dbPath } = seedConfigs(3);
    const result = runCli([
      "list", "--json", "--detail", "compact", "--fields", "id,slug,name,version", "--limit", "2",
    ], dbPath);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { configs: Array<Record<string, unknown>>; _meta: { fields: string[] } };
    expect(payload.configs).toHaveLength(2);
    expect(Object.keys(payload.configs[0] ?? {})).toEqual(["id", "slug", "name", "version"]);
    expect(payload._meta.fields).toEqual(["id", "slug", "name", "version"]);
  });

  test("compact all explicitly walks every source page and returns the complete collection", () => {
    const { dbPath } = seedConfigs(125);
    const result = runCli(["list", "--json", "--detail", "compact", "--all"], dbPath);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { configs: unknown[]; _meta: Record<string, unknown> };
    expect(payload.configs).toHaveLength(125);
    expect(new Set(payload.configs.map((config) => JSON.stringify(config))).size).toBe(125);
    expect(payload._meta).toMatchObject({
      count: 125,
      total: 125,
      limit: null,
      cursor: 0,
      next_cursor: null,
      has_more: false,
      complete: true,
      truncated: false,
      truncation_reason: null,
      detail: "compact",
    });
  });

  test("a terminal cursor page does not claim the omitted prefix is complete", () => {
    const { dbPath } = seedConfigs(4);
    const result = runCli(["list", "--json", "--detail", "compact", "--limit", "2", "--cursor", "2"], dbPath);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { _meta: Record<string, unknown> };
    expect(payload._meta).toMatchObject({
      count: 2, total: 4, cursor: 2, next_cursor: null, has_more: false,
      complete: false, truncated: true, truncation_reason: "cursor",
    });
  });

  test("invalid field names and ambiguous all bounds fail before producing JSON", () => {
    const { dbPath } = seedConfigs(3);
    const unknown = runCli(["list", "--json", "--detail", "compact", "--fields", "id,content"], dbPath);
    const boundedAll = runCli(["list", "--json", "--detail", "compact", "--all", "--limit", "2"], dbPath);

    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toContain("Unknown compact config field");
    expect(boundedAll.status).toBe(1);
    expect(boundedAll.stdout).toBe("");
    expect(boundedAll.stderr).toContain("--all cannot be combined");
  });

  test("full detail is an explicit bounded content read and pretty is opt-in", () => {
    const { dbPath } = seedConfigs(4);
    const compact = runCli(["list", "--json", "--detail", "full", "--limit", "2"], dbPath);
    const pretty = runCli(["list", "--json", "--detail", "full", "--limit", "2", "--pretty"], dbPath);

    expect(compact.status).toBe(0);
    expect(pretty.status).toBe(0);
    const payload = JSON.parse(compact.stdout) as { configs: Array<{ content: string }>; _meta: Record<string, unknown> };
    expect(payload.configs).toHaveLength(2);
    expect(payload.configs[0]?.content).toContain("CONTENT_CANARY_DO_NOT_LEAK");
    expect(payload._meta).toMatchObject({ count: 2, total: 4, detail: "full", complete: false });
    expect(compact.stdout.trim().split("\n")).toHaveLength(1);
    expect(pretty.stdout.trim().split("\n").length).toBeGreaterThan(1);
  });
});

describe("configs report output", () => {
  test("json output is parseable and follows the stable report schema", () => {
    const home = makeTempRoot("open-configs-report-json-");
    tempDirs.push(home);
    const dbPath = join(home, "configs.db");
    const result = runCli(["report", "--json"], dbPath, home);

    expect(result.status).toBe(0);
    // Local mode must say so on stderr (owner ruling 2026-09-04); the JSON on
    // stdout stays parseable and unchanged.
    expect(result.stderr).toContain("local mode");
    expect(JSON.parse(result.stdout)).toEqual({
      schema_version: 1,
      configs: {
        total: 0,
        files: 0,
        references: 0,
        templates: 0,
        project: 0,
      },
      profiles: {
        total: 0,
      },
      drift: {
        drifted: 0,
        missing: 0,
      },
      secrets: {
        findings: 0,
        policy: "redacted_on_ingest",
      },
      by_agent: {},
      by_category: {},
    });
  });

  test("the no-flag report preserves the existing human surface", () => {
    const home = makeTempRoot("open-configs-report-human-");
    tempDirs.push(home);
    const dbPath = join(home, "configs.db");
    const result = runCli(["report"], dbPath, home);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("local mode");
    expect(result.stdout).toBe(
      "configs report\n" +
      "\n" +
      "  Total:       0 configs (0 files, 0 references)\n" +
      "  Templates:   0 (with {{VAR}} placeholders)\n" +
      "  Profiles:    0\n" +
      "  Drift:       0 ✓ drifted, 0 missing\n" +
      "  Secrets:     0 ✓ (redacted on ingest)\n" +
      "\n" +
      "  By agent:\n" +
      "\n" +
      "  By category:\n",
    );
  });
});

describe("configs apply ownership output", () => {
  test("CLI direct and profile dry-runs report owned instructions and preserve OpenCode settings", () => {
    const home = makeTempRoot("open-configs-apply-cli-");
    tempDirs.push(home);
    const dbPath = join(home, "configs.db");
    process.env["HASNA_INSTRUCTIONS_DB_PATH"] = dbPath;
    resetDatabase();
    const db = getDatabase(dbPath);
    const claude = createConfig({
      name: "Claude Legacy Writer",
      category: "rules",
      agent: "claude",
      content: "legacy claude",
      target_path: "~/.claude/CLAUDE.md",
    }, db);
    const antigravity = createConfig({
      name: "Antigravity Legacy Writer",
      category: "rules",
      agent: "antigravity",
      content: "legacy antigravity",
      target_path: "~/.gemini/GEMINI.md",
    }, db);
    const opencode = createConfig({
      name: "OpenCode Settings",
      category: "agent",
      agent: "opencode",
      format: "json",
      content: JSON.stringify({ model: "preserved-model", mcp: { preserved: true } }),
      target_path: "~/.config/opencode/opencode.json",
    }, db);
    const profile = createProfile({ name: "Ownership Preview" }, db);
    for (const config of [claude, antigravity, opencode]) addConfigToProfile(profile.id, config.id, db);
    resetDatabase();
    delete process.env["HASNA_INSTRUCTIONS_DB_PATH"];

    const claudePreview = runCli(["apply", claude.slug, "--dry-run"], dbPath, home);
    const antigravityPreview = runCli(["apply", antigravity.slug, "--dry-run"], dbPath, home);
    const profilePreview = runCli([
      "profile",
      "apply",
      profile.slug,
      "--dry-run",
      "--hostname",
      "station01",
      "--os",
      "linux",
      "--arch",
      "arm64",
    ], dbPath, home);

    expect(claudePreview.status).toBe(0);
    expect(claudePreview.stdout).toContain("[owned]");
    expect(claudePreview.stdout).toContain("instructions-session-renderer");
    expect(antigravityPreview.status).toBe(0);
    expect(antigravityPreview.stdout).toContain("[owned]");
    expect(antigravityPreview.stdout).toContain(".gemini/GEMINI.md");
    expect(profilePreview.status).toBe(0);
    expect(profilePreview.stdout).toContain(".claude/CLAUDE.md");
    expect(profilePreview.stdout).toContain(".gemini/GEMINI.md");
    expect(profilePreview.stdout).toContain("[dry-run]");
    expect(profilePreview.stdout).toContain(".config/opencode/opencode.json");
    expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(home, ".gemini", "GEMINI.md"))).toBe(false);
    expect(existsSync(join(home, ".config", "opencode", "opencode.json"))).toBe(false);
  });
});
