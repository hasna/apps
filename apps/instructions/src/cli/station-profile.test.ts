import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

describe("station-profile CLI", () => {
  test("refresh writes the cache and show prints it back", () => {
    const root = makeTempRoot("station-profile-cli-");
    try {
      const env = {
        HOME: root,
        HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"),
        HASNA_MACHINES_MANIFEST_PATH: join(root, "no-manifest.json"),
        BUN_INSTALL: join(root, "bun"),
      };
      const refreshed = runCli(["station-profile", "refresh", "--json"], env);
      expect(refreshed.status).toBe(0);
      const result = JSON.parse(refreshed.stdout) as { path: string; bytes: number; content: string; machine: { id: string } };
      expect(result.bytes).toBeLessThanOrEqual(600);
      expect(result.content.startsWith("Station:")).toBe(true);
      expect(existsSync(result.path)).toBe(true);

      const shown = runCli(["station-profile", "show"], env);
      expect(shown.status).toBe(0);
      expect(shown.stdout).toBe(result.content + "\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preview builds without writing; path prints the cache path", () => {
    const root = makeTempRoot("station-profile-cli-preview-");
    try {
      const env = {
        HOME: root,
        HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"),
        HASNA_MACHINES_MANIFEST_PATH: join(root, "no-manifest.json"),
        BUN_INSTALL: join(root, "bun"),
      };
      const preview = runCli(["station-profile", "preview"], env);
      expect(preview.status).toBe(0);
      expect(preview.stdout.startsWith("Station:")).toBe(true);
      expect(existsSync(join(root, ".hasna", "instructions", "station-profile.md"))).toBe(false);

      const pathOut = runCli(["station-profile", "path"], env);
      expect(pathOut.status).toBe(0);
      expect(pathOut.stdout.trim()).toBe(join(root, ".hasna", "instructions", "station-profile.md"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("show without a cache fails loudly", () => {
    const root = makeTempRoot("station-profile-cli-nocache-");
    try {
      const env = { HOME: root, HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions") };
      const shown = runCli(["station-profile", "show"], env);
      expect(shown.status).not.toBe(0);
      expect(shown.stderr).toContain("No cached station profile");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("station-profile session injection", () => {
  function withCache(root: string): { env: Record<string, string | undefined>; cachePath: string } {
    const env = {
      HOME: root,
      HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"),
      HASNA_MACHINES_MANIFEST_PATH: join(root, "no-manifest.json"),
      BUN_INSTALL: join(root, "bun"),
    };
    const refreshed = runCli(["station-profile", "refresh"], env);
    expect(refreshed.status).toBe(0);
    return { env, cachePath: join(root, ".hasna", "instructions", "station-profile.md") };
  }

  test("session plan injects the cached station-profile source by default", () => {
    const root = makeTempRoot("station-profile-cli-inject-");
    try {
      mkdirSync(join(root, "sources"), { recursive: true });
      writeFileSync(join(root, "sources", "global.md"), "Global source");
      const { env } = withCache(root);
      const planned = runCli([
        "session", "plan",
        "--tool", "claude",
        "--profile", "account999",
        "--target-home", "~/claude-home",
        "--source", "global:global-cli=~/sources/global.md",
        "--json",
      ], env);
      expect(planned.status).toBe(0);
      const plan = JSON.parse(planned.stdout) as { manifest: { sources: Array<{ id: string; layer: string }>; files: Array<{ relativePath: string }> } };
      const station = plan.manifest.sources.find((source) => source.id === "station-profile");
      expect(station).toBeDefined();
      expect(station!.layer).toBe("machine");
      expect(plan.manifest.files.some((file) => file.relativePath.includes("station-profile"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--no-station-profile keeps the render unchanged", () => {
    const root = makeTempRoot("station-profile-cli-noinject-");
    try {
      mkdirSync(join(root, "sources"), { recursive: true });
      writeFileSync(join(root, "sources", "global.md"), "Global source");
      const { env } = withCache(root);
      const planned = runCli([
        "session", "plan",
        "--tool", "claude",
        "--profile", "account999",
        "--target-home", "~/claude-home",
        "--source", "global:global-cli=~/sources/global.md",
        "--no-station-profile",
        "--json",
      ], env);
      expect(planned.status).toBe(0);
      const plan = JSON.parse(planned.stdout) as { manifest: { sources: Array<{ id: string }> } };
      expect(plan.manifest.sources.some((source) => source.id === "station-profile")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no cache means no injection and no behavior change", () => {
    const root = makeTempRoot("station-profile-cli-nocacheinject-");
    try {
      mkdirSync(join(root, "sources"), { recursive: true });
      writeFileSync(join(root, "sources", "global.md"), "Global source");
      const env = {
        HOME: root,
        HASNA_CONFIGS_HOME: join(root, ".hasna", "instructions"),
        HASNA_MACHINES_MANIFEST_PATH: join(root, "no-manifest.json"),
        BUN_INSTALL: join(root, "bun"),
      };
      const planned = runCli([
        "session", "plan",
        "--tool", "claude",
        "--profile", "account999",
        "--target-home", "~/claude-home",
        "--source", "global:global-cli=~/sources/global.md",
        "--json",
      ], env);
      expect(planned.status).toBe(0);
      const plan = JSON.parse(planned.stdout) as { manifest: { sources: Array<{ id: string }> } };
      expect(plan.manifest.sources.some((source) => source.id === "station-profile")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
