import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installCustomSource, isCustomSource } from "./custom-install.js";
import { readCustomManifest, customHookDir } from "./manifest.js";
import { closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-install-test-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeHookDir(base: string, name: string, version = "1.0.0"): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ name, version, description: `${name} demo`, events: ["PostToolUse"], script: "hook.ts" }, null, 2),
    "utf-8",
  );
  writeFileSync(join(dir, "hook.ts"), `export const ${name} = 1;`, "utf-8");
  return dir;
}

describe("source classification", () => {
  test("recognizes git URLs, manifest URLs, and local paths", () => {
    expect(isCustomSource("git@github.com:org/repo.git")).toBe(true);
    expect(isCustomSource("https://github.com/org/repo.git")).toBe(true);
    expect(isCustomSource("https://example.com/hook/manifest.json")).toBe(true);
    expect(isCustomSource("/tmp/definitely-not-a-path-xyz")).toBe(false);
    expect(isCustomSource("gitguard")).toBe(false);
  });
});

describe("install from local path", () => {
  test("copies the manifest and script into the custom dir", async () => {
    const src = makeHookDir(join(TEST_DIR, "sources"), "local-hook");
    const result = await installCustomSource(src);
    expect(result.name).toBe("local-hook");
    expect(result.kind).toBe("local");
    const parsed = readCustomManifest("local-hook");
    expect(parsed?.manifest.name).toBe("local-hook");
    expect(parsed?.manifest.version).toBe("1.0.0");
    expect(existsSync(parsed!.scriptPath)).toBe(true);
    expect(parsed!.scriptPath).toBe(join(customHookDir("local-hook"), "hook.ts"));
  });

  test("rejects a directory without a manifest", async () => {
    const empty = join(TEST_DIR, "sources", "empty-dir");
    mkdirSync(empty, { recursive: true });
    await expect(installCustomSource(empty)).rejects.toThrow(/manifest/);
  });

  test("installs from a manifest.json file path directly", async () => {
    const src = makeHookDir(join(TEST_DIR, "sources"), "manifest-path-hook");
    const result = await installCustomSource(join(src, "manifest.json"));
    expect(result.name).toBe("manifest-path-hook");
    expect(readCustomManifest("manifest-path-hook")).toBeTruthy();
  });
});

describe("install from git URL", () => {
  test("clones a local git repo fixture and installs its manifest", async () => {
    const repo = join(TEST_DIR, "fixture-repo");
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, "manifest.json"),
      JSON.stringify({ name: "git-hook", version: "3.0.0", description: "git fixture", events: ["PostToolUse"], script: "hook.ts" }, null, 2),
      "utf-8",
    );
    writeFileSync(join(repo, "hook.ts"), "export const gitHook = 1;", "utf-8");
    const init = Bun.spawn(
      ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@test.local", "init", "-q", "-b", "main", repo],
      { stdout: "pipe", stderr: "pipe" },
    );
    await init.exited;
    const add = Bun.spawn(["git", "add", "-A"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(
      ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@test.local", "commit", "-q", "-m", "add hook"],
      { cwd: repo, stdout: "pipe", stderr: "pipe" },
    );
    await commit.exited;

    const result = await installCustomSource(`file://${repo}`);
    expect(result.name).toBe("git-hook");
    expect(result.kind).toBe("git");
    expect(result.version).toBe("3.0.0");
    const parsed = readCustomManifest("git-hook");
    expect(parsed?.manifest.name).toBe("git-hook");
    expect(existsSync(parsed!.scriptPath)).toBe(true);
  }, 30000);
});

describe("install from manifest URL", () => {
  test("fetches manifest and relative script", async () => {
    const served = await Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/hooks/manifest.json") {
          return new Response(
            JSON.stringify({ name: "url-hook", version: "2.0.0", events: ["Stop"], script: "hook.ts" }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === "/hooks/hook.ts") {
          return new Response("export const urlHook = 1;", { headers: { "content-type": "text/plain" } });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const url = `http://127.0.0.1:${served.port}/hooks/manifest.json`;
      const result = await installCustomSource(url);
      expect(result.name).toBe("url-hook");
      expect(result.kind).toBe("url");
      const parsed = readCustomManifest("url-hook");
      expect(parsed?.manifest.version).toBe("2.0.0");
      expect(parsed?.scriptContent).toContain("urlHook");
    } finally {
      served.stop();
    }
  });
});
