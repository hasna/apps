import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { resolveMcpRoot } from "./mcp.js";
import { getStore, LocalStore, ApiStore } from "./store/index.js";
import type { HasnaStorageClient } from "./store/contracts-client/index.js";

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

  it("ApiStore.listSecrets skips a secret the server cannot return instead of aborting", async () => {
    // Regression for `export-env` (cloud): one server-side-undecryptable secret
    // used to reject the whole Promise.all and 500 the entire command.
    const transport = {
      baseUrl: "https://secrets.hasna.xyz/v1",
      async get<T>(path: string, opts?: { query?: Record<string, unknown> }): Promise<T> {
        if (path === "/secrets") {
          return { secrets: [{ key: "ok/one" }, { key: "bad/two" }, { key: "ok/three" }] } as T;
        }
        if (path === "/secrets/get") {
          const key = String(opts?.query?.key);
          if (key === "bad/two") throw Object.assign(new Error("Unsupported state"), { status: 500 });
          return { key, value: `v-${key}`, type: "other", created_at: "", updated_at: "" } as T;
        }
        throw new Error(`unexpected GET ${path}`);
      },
    };
    const store = new ApiStore({ transport } as unknown as HasnaStorageClient);
    const secrets = await store.listSecrets();
    expect(secrets.map((s) => s.key).sort()).toEqual(["ok/one", "ok/three"]);
    expect(secrets.every((s) => !s.value.includes("bad"))).toBe(true);
  });

  it("LocalStore feedback works on a pre-existing vault missing the category column", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-secrets-fb-"));
    const dbPath = join(dir, "vault.db");
    // Simulate an OLD vault: feedback table created before `category` existed.
    const seed = new Database(dbPath);
    seed.exec(
      "CREATE TABLE feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, email TEXT, version TEXT, created_at TEXT)",
    );
    seed.close();

    const prev = process.env.HASNA_SECRETS_DB_PATH;
    process.env.HASNA_SECRETS_DB_PATH = dbPath;
    try {
      const { resetDb } = await import("./db.js");
      resetDb();
      const store = getStore({ HASNA_SECRETS_DB_PATH: dbPath } as unknown as NodeJS.ProcessEnv);
      await store.sendFeedback("upgrade migration works", undefined, "bug");
      const check = new Database(dbPath);
      const row = check.prepare("SELECT category FROM feedback").get() as { category: string };
      check.close();
      expect(row.category).toBe("bug");
      resetDb();
    } finally {
      if (prev === undefined) delete process.env.HASNA_SECRETS_DB_PATH;
      else process.env.HASNA_SECRETS_DB_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
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
