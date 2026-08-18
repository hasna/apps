import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
let root: string;

const SESSIONS_CLIENT_ENV_KEYS = [
  "HASNA_SESSIONS_API_URL",
  "HASNA_SESSIONS_API_KEY",
  "SESSIONS_API_URL",
  "SESSIONS_API_KEY",
] as const;

/** Spawn env with the ambient hosted-client pair scrubbed, plus overrides. */
function cliTestEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of SESSIONS_CLIENT_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}

function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: repoRoot,
    env: cliTestEnv({
      HOME: root,
      CLAUDE_PATH: join(root, "claude"),
      CODEX_PATH: join(root, "codex"),
      CODEWITH_PATH: join(root, "codewith"),
      GEMINI_PATH: join(root, "gemini"),
      SESSIONS_DB_PATH: join(root, "sessions.db"),
      HASNA_SESSIONS_DB_PATH: join(root, "sessions.db"),
      HASNA_SESSIONS_DIR: join(root, "sessions-home"),
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
}

beforeEach(() => {
  root = join(tmpdir(), `sessions-sync-cli-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sessions content sync CLI", () => {
  it("describes storage without removed deployment-mode vocabulary in current help", () => {
    const rootHelp = runCli(["--help"]);
    expect(rootHelp.exitCode).toBe(0);
    const rootHelpText = Buffer.from(rootHelp.stdout).toString("utf-8");
    expect(rootHelpText).not.toContain("self_hosted");
    const normalizedRootHelp = rootHelpText.replace(/\s+/g, " ");
    expect(normalizedRootHelp).toContain("local SQLite store");
    expect(normalizedRootHelp).toContain("configured server HTTP API");

    const syncHelp = runCli(["sync", "--help"]);
    expect(syncHelp.exitCode).toBe(0);
    const syncHelpText = Buffer.from(syncHelp.stdout).toString("utf-8");
    expect(syncHelpText).not.toContain("self_hosted");
    expect(syncHelpText.replace(/\s+/g, " ")).toContain("configured server HTTP API");
    expect(syncHelpText).toContain("--dry-run");
    expect(syncHelpText).toContain("--watch");
    expect(syncHelpText).toContain("Required for live server HTTP API pushes");

    const daemonHelp = runCli(["daemon", "--help"]);
    expect(daemonHelp.exitCode).toBe(0);
    const daemonHelpText = Buffer.from(daemonHelp.stdout).toString("utf-8");
    expect(daemonHelpText).not.toContain("self_hosted");
    expect(daemonHelpText.replace(/\s+/g, " ")).toContain("configured server HTTP API");
    expect(daemonHelpText).toContain("--max-iterations");
    expect(daemonHelpText).toContain("--status");
    expect(daemonHelpText).toContain('default: "60"');

    const backfillHelp = runCli(["backfill", "--help"]);
    expect(backfillHelp.exitCode).toBe(0);
    const backfillHelpText = Buffer.from(backfillHelp.stdout).toString("utf-8");
    expect(backfillHelpText).not.toContain("self_hosted");
    expect(backfillHelpText.replace(/\s+/g, " ")).toContain("configured server HTTP API");
  });

  it("exposes provider roots and ingest observability through daemon status", () => {
    mkdirSync(join(root, "codewith", "sessions"), { recursive: true });

    const jsonResult = runCli(["daemon", "--status", "--json"]);
    expect(jsonResult.exitCode).toBe(0);
    expect(Buffer.from(jsonResult.stderr).toString("utf-8")).toBe("");
    const status = JSON.parse(Buffer.from(jsonResult.stdout).toString("utf-8"));
    const codewith = status.roots.find((entry: { source: string }) => entry.source === "codewith");
    expect(codewith).toMatchObject({
      source: "codewith",
      exists: true,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lagSeconds: 0,
      skippedFiles: 0,
      lastError: null,
    });

    const humanResult = runCli(["daemon", "--status"]);
    expect(humanResult.exitCode).toBe(0);
    const output = Buffer.from(humanResult.stdout).toString("utf-8");
    expect(output).toContain("daemon status");
    expect(output).toContain("codewith");
    expect(output).toContain("lag(s)");
    expect(output).toContain("last attempt");
    expect(output).toContain("last success");
    expect(output).toContain("last error");
  });

  it("defaults sync --limit to a bounded value mirroring daemon so a bare sync does not scan the whole store", () => {
    // Regression: a bare `sessions sync` had no default --limit and scanned the entire
    // local store (~13k sessions), parsing per-session content and hanging with no output.
    // Both `sync` and `daemon` must expose the same bounded default (500).
    const limitDefault = /-l, --limit <n>[\s\S]*?\(default:\s+"500"\)/;

    const syncHelp = Buffer.from(runCli(["sync", "--help"]).stdout).toString("utf-8");
    expect(syncHelp).toMatch(limitDefault);

    const daemonHelp = Buffer.from(runCli(["daemon", "--help"]).stdout).toString("utf-8");
    expect(daemonHelp).toMatch(limitDefault);
  });

  it("dry-runs content sync as parseable JSON without API credentials", () => {
    const result = runCli([
      "sync",
      "--dry-run",
      "--no-ingest",
      "--limit",
      "1",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stderr).toString("utf-8")).toBe("");

    const payload = JSON.parse(Buffer.from(result.stdout).toString("utf-8"));
    expect(payload.target).toBe("hosted_api");
    expect(payload.dryRun).toBe(true);
    expect(payload.scanned).toBe(0);
    expect(payload.backup.guidance).toContain("require a successful --backup-command");
    expect(payload.backup.hook.configured).toBe(false);
  });

  it("does not run or echo backup hooks during dry-run", () => {
    const result = runCli([
      "sync",
      "--dry-run",
      "--no-ingest",
      "--backup-command",
      "echo should-not-appear",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stderr).toString("utf-8")).toBe("");
    expect(Buffer.from(result.stdout).toString("utf-8")).not.toContain("should-not-appear");

    const payload = JSON.parse(Buffer.from(result.stdout).toString("utf-8"));
    expect(payload.backup.hook.configured).toBe(true);
    expect(payload.backup.hook.ran).toBe(false);
    expect(payload.backup.hook.skippedReason).toBe("dry-run");
  });
});
