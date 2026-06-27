import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMcpRoot } from "./mcp.js";

const rootDir = join(import.meta.dir, "..");

describe("secrets storage surface contract", () => {
  it("documents storage commands in help instead of cloud commands", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/index.ts", "--help"],
      cwd: rootDir,
      env: {
        ...process.env,
        HASNA_SECRETS_DB_PATH: ":memory:",
        NO_COLOR: "1",
      },
    });

    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("storage status");
    expect(stdout).toContain("secrets storage status");
    expect(stdout).not.toContain("cloud status");
    expect(stdout).not.toContain("cloud_push");
  });

  it("does not keep a hidden cloud CLI command alias", () => {
    const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
    const retiredAlias = `case "${["cl", "oud"].join("")}":`;

    expect(source).toContain('case "storage":');
    expect(source).not.toContain(retiredAlias);
  });

  it("registers storage MCP tools instead of cloud tools", () => {
    const source = readFileSync(join(import.meta.dir, "mcp.ts"), "utf8");

    expect(source).toContain('"storage_status"');
    expect(source).toContain('"storage_push"');
    expect(source).toContain('"storage_pull"');
    expect(source).toContain('"storage_sync"');
    expect(source).toContain('"scan_workspace_exposures"');
    expect(source).toContain('"scan_history_exposures"');
    expect(source).toContain("MCP scan root must be inside the server working directory");
    expect(source).not.toContain('"cloud_status"');
    expect(source).not.toContain('"cloud_push"');
    expect(source).not.toContain('"cloud_pull"');
    expect(source).not.toContain('"cloud_sync"');
  });

  it("keeps MCP scan roots inside the real server working directory", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "open-secrets-mcp-root-"));
    const cwd = join(tempRoot, "cwd");
    const child = join(cwd, "child");
    const outside = join(tempRoot, "outside");
    const link = join(cwd, "linked-outside");
    const originalCwd = process.cwd();

    mkdirSync(child, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, link, "dir");

    try {
      process.chdir(cwd);
      const allowed = resolveMcpRoot("child");
      const escaped = resolveMcpRoot("linked-outside");

      expect(allowed.ok).toBe(true);
      if (allowed.ok) expect(allowed.root).toBe(child);
      expect(escaped.ok).toBe(false);
      if (!escaped.ok) {
        expect(escaped.root).toBe(outside);
        expect(escaped.error).toContain("MCP scan root must be inside");
      }
    } finally {
      process.chdir(originalCwd);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("storage status includes canonical RDS metadata without values", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/index.ts", "storage", "status"],
      cwd: rootDir,
      env: {
        ...process.env,
        HASNA_SECRETS_DB_PATH: ":memory:",
        NO_COLOR: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    const status = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(status.canonical).toEqual({
      cluster: "hasna-xyz-infra-apps-prod-postgres",
      database: "secrets",
      runtimeSecretPath: "hasna/xyz/opensource/secrets/prod/rds",
      primaryEnv: "HASNA_SECRETS_DATABASE_URL",
      fallbackEnv: "SECRETS_DATABASE_URL",
    });
    expect(JSON.stringify(status)).not.toContain("postgres://user:secret");
  });
});
