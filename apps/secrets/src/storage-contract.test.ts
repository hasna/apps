import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMcpRoot } from "./mcp.js";
import { getStore, LocalStore, ApiStore } from "./store/index.js";

const rootDir = join(import.meta.dir, "..");

describe("secrets storage surface contract", () => {
  it("resolves LocalStore without api env and ApiStore with url+key", () => {
    const local = getStore({} as NodeJS.ProcessEnv);
    expect(local).toBeInstanceOf(LocalStore);
    expect(local.mode).toBe("local");

    const api = getStore({
      HASNA_SECRETS_API_URL: "https://secrets.hasna.xyz",
      HASNA_SECRETS_API_KEY: "hasna_secrets_test_key",
    } as unknown as NodeJS.ProcessEnv);
    expect(api).toBeInstanceOf(ApiStore);
    expect(api.mode).toBe("api");
  });

  it("does not embed the api key in the ApiStore descriptor", () => {
    const api = getStore({
      HASNA_SECRETS_API_URL: "https://secrets.hasna.xyz",
      HASNA_SECRETS_API_KEY: "hasna_secrets_super_secret_value",
    } as unknown as NodeJS.ProcessEnv);
    const descriptor = api.describe();
    expect(descriptor.mode).toBe("api");
    expect(JSON.stringify(descriptor)).not.toContain("hasna_secrets_super_secret_value");
  });

  it("removed the forbidden DSN storage command from help", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/index.ts", "--help"],
      cwd: rootDir,
      env: { ...process.env, HASNA_SECRETS_DB_PATH: ":memory:", NO_COLOR: "1" },
    });

    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).not.toContain("storage status");
    expect(stdout).not.toContain("storage push");
    expect(stdout).toContain("HASNA_SECRETS_API_URL");
  });

  it("has no DSN storage command or direct sqlite/DATABASE_URL in the CLI", () => {
    const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
    expect(source).not.toContain('case "storage":');
    expect(source).not.toContain("storage-sync");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("getDb");
    // Data commands route through the resolved Store.
    expect(source).toContain("getStore");
    expect(source).toContain("store().");
  });

  it("registers Store-routed MCP tools and no DSN storage tools", () => {
    const source = readFileSync(join(import.meta.dir, "mcp.ts"), "utf8");
    expect(source).toContain("getStore");
    expect(source).toContain('"scan_workspace_exposures"');
    expect(source).toContain('"scan_history_exposures"');
    expect(source).toContain("MCP scan root must be inside the server working directory");
    expect(source).not.toContain('"storage_status"');
    expect(source).not.toContain('"storage_push"');
    expect(source).not.toContain('"storage_pull"');
    expect(source).not.toContain('"storage_sync"');
    expect(source).not.toContain("getDb");
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
});
