import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatShortUrl,
  getConfigPath,
  getDataDir,
  getDatabasePath,
  loadConfig,
  normalizeHostname,
  saveConfig,
  updateConfig,
} from "./config.js";

describe("app home derivation (the caller's env, never a silent process.env read)", () => {
  test("SHORTLINKS_HOME wins, then HASNA_HOME/shortlinks, then $HOME/.hasna/shortlinks", () => {
    expect(getDataDir({ SHORTLINKS_HOME: "/x/home", HASNA_HOME: "/x/hasna", HOME: "/x/user" })).toBe(resolve("/x/home"));
    expect(getDataDir({ HASNA_HOME: "/x/hasna", HOME: "/x/user" })).toBe(join(resolve("/x/hasna"), "shortlinks"));
    expect(getDataDir({ HOME: "/x/user" })).toBe(join(resolve("/x/user"), ".hasna", "shortlinks"));
    // Declared-but-blank means unset, as everywhere else at this seam.
    expect(getDataDir({ SHORTLINKS_HOME: " ", HOME: "/x/user" })).toBe(join(resolve("/x/user"), ".hasna", "shortlinks"));
  });

  test("path lookups create nothing: only a write creates the app home", () => {
    const home = mkdtempSync(join(tmpdir(), "shortlinks-home-"));
    const env = { HOME: home };
    try {
      const dir = getDataDir(env);
      expect(getConfigPath(env)).toBe(join(dir, "config.json"));
      expect(getDatabasePath(undefined, env)).toBe(join(dir, "shortlinks.db"));
      expect(getDatabasePath("./explicit.db", env)).toBe(resolve("./explicit.db"));
      expect(getDatabasePath(undefined, { ...env, SHORTLINKS_DB: "/x/other.db" })).toBe(resolve("/x/other.db"));
      expect(loadConfig(env)).toEqual({});
      // Nothing was created by the lookups above — not even the directory.
      expect(existsSync(dir)).toBe(false);
      saveConfig({ defaultDomain: "has.na" }, env);
      expect(loadConfig(env).defaultDomain).toBe("has.na");
      expect(existsSync(join(dir, "config.json"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("normalizeHostname", () => {
  test("normalizes protocol, case, path, and trailing dot", () => {
    expect(normalizeHostname("https://HAS.NA/docs.")).toBe("has.na");
    expect(normalizeHostname("go.example.com.")).toBe("go.example.com");
  });

  test("rejects hostnames with invalid DNS labels", () => {
    expect(() => normalizeHostname("-bad.example.com")).toThrow("Invalid domain");
    expect(() => normalizeHostname("bad-.example.com")).toThrow("Invalid domain");
    expect(() => normalizeHostname(`go.${"a".repeat(64)}.example.com`)).toThrow("Invalid domain");
  });

  test("rejects empty and whitespace-only hostnames", () => {
    expect(() => normalizeHostname("")).toThrow("Domain is required.");
    expect(() => normalizeHostname("   ")).toThrow("Domain is required.");
  });
});

describe("formatShortUrl", () => {
  test("normalizes an optional public base URL before resolving a slug", () => {
    expect(formatShortUrl("has.na", "docs", "https://links.example/base")).toBe(
      "https://links.example/base/docs",
    );
    expect(formatShortUrl("has.na", "docs", "https://links.example/base/")).toBe(
      "https://links.example/base/docs",
    );
  });

  test("uses the normalized hostname when no public base URL is configured", () => {
    expect(formatShortUrl("has.na", "docs")).toBe("https://has.na/docs");
  });
});

describe("config updates", () => {
  test("merges nested cloudflare settings without dropping existing values", () => {
    const home = mkdtempSync(join(tmpdir(), "shortlinks-config-"));
    const previousHome = process.env.SHORTLINKS_HOME;
    process.env.SHORTLINKS_HOME = home;
    try {
      updateConfig({
        defaultDomain: "has.na",
        cloudflare: { accountId: "account-1", workerName: "worker-1" },
      });
      expect(updateConfig({ cloudflare: { origin: "origin-1" } })).toEqual({
        defaultDomain: "has.na",
        cloudflare: { accountId: "account-1", workerName: "worker-1", origin: "origin-1" },
      });
      expect(loadConfig().cloudflare?.workerName).toBe("worker-1");
    } finally {
      if (previousHome === undefined) delete process.env.SHORTLINKS_HOME;
      else process.env.SHORTLINKS_HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("getClickSalt", () => {
  test("initializes one salt across concurrent first-use processes", async () => {
    const home = mkdtempSync(join(tmpdir(), "shortlinks-click-salt-"));
    const configUrl = pathToFileURL(join(process.cwd(), "src/config.ts")).href;
    const script = `import { getClickSalt } from ${JSON.stringify(configUrl)};\nconsole.log(getClickSalt());`;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.SHORTLINKS_HOME = home;
    delete env.SHORTLINKS_CLICK_SALT;

    try {
      const processes = Array.from({ length: 24 }, () => Bun.spawn({
        cmd: ["bun", "-e", script],
        cwd: process.cwd(),
        env,
        stdout: "pipe",
        stderr: "pipe",
      }));
      const results = await Promise.all(processes.map(async (proc) => ({
        exitCode: await proc.exited,
        stdout: await new Response(proc.stdout).text(),
        stderr: await new Response(proc.stderr).text(),
      })));
      const failures = results.filter((result) => result.exitCode !== 0);
      if (failures.length > 0) {
        throw new Error(failures.map((result) => result.stderr).join("\n"));
      }

      const salts = results.map((result) => result.stdout.trim()).filter(Boolean);
      expect(salts).toHaveLength(24);
      expect(new Set(salts).size).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
