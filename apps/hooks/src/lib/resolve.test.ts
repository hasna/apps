/**
 * Regression tests for runtime bundled-hooks resolution (0.6.0/0.6.1 defect).
 *
 * The 0.6.0 bundle baked a build-time `__dirname` into the output, so bundled
 * hooks resolved only on the machine that built the package. Resolution must
 * follow the installed package's own location via `import.meta.url`, exactly
 * like the 0.5.0 runtime mechanism.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveBundledHooksDir, resolveHookDir } from "./resolve.js";
import { readLock } from "./store.js";

const PKG_DIR = join(import.meta.dir, "..", "..");

describe("resolveBundledHooksDir", () => {
  test("resolves the source-tree layout from the module dir", () => {
    const base = resolveBundledHooksDir(join(PKG_DIR, "src", "lib"));
    expect(existsSync(join(base, "hook-gitguard"))).toBe(true);
    expect(base).toBe(join(PKG_DIR, "hooks"));
  });

  test("resolves an installed layout from a foreign prefix (bin/ + hooks/), never a baked build path", () => {
    const prefix = mkdtempSync(join(tmpdir(), "hooks-install-prefix-"));
    try {
      mkdirSync(join(prefix, "bin"), { recursive: true });
      mkdirSync(join(prefix, "hooks", "pre-bash", "src"), { recursive: true });
      const base = resolveBundledHooksDir(join(prefix, "bin"));
      expect(base).toBe(join(prefix, "hooks"));
      expect(base).not.toContain(PKG_DIR);
      expect(base).not.toContain("worktrees");
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  test("bundled hooks resolve through the runtime dir", () => {
    const dir = resolveHookDir("pre-bash");
    expect(dir).toBeTruthy();
    expect(existsSync(join(dir!, "src", "hook.ts"))).toBe(true);
  });
});

describe("bundled hook runs from an install prefix other than the build worktree", () => {
  test("sync + run use the foreign prefix's own hook bytes", async () => {
    const prefix = mkdtempSync(join(tmpdir(), "hooks-install-prefix-"));
    try {
      mkdirSync(join(prefix, "bin"), { recursive: true });
      mkdirSync(join(prefix, "home", ".hasna", "hooks"), { recursive: true });
      const foreignScript = `console.log(JSON.stringify({ continue: true, origin: "foreign-prefix" }));`;
      mkdirSync(join(prefix, "hooks", "pre-bash", "src"), { recursive: true });
      writeFileSync(join(prefix, "hooks", "pre-bash", "src", "hook.ts"), foreignScript);
      writeFileSync(join(prefix, "package.json"), readFileSync(join(PKG_DIR, "package.json"), "utf-8"));
      symlinkSync(join(PKG_DIR, "node_modules"), join(prefix, "node_modules"));

      const build = Bun.spawnSync(
        [
          "bun",
          "build",
          join(PKG_DIR, "src", "cli", "index.tsx"),
          "--outdir",
          join(prefix, "bin"),
          "--target",
          "bun",
          "--external",
          "pg",
          "--external",
          "ink",
          "--external",
          "react",
          "--external",
          "chalk",
          "--external",
          "conf",
          "--external",
          "@modelcontextprotocol/sdk",
          "--external",
          "zod",
        ],
        { cwd: PKG_DIR },
      );
      expect(build.exitCode, build.stderr.toString()).toBe(0);
      expect(existsSync(join(prefix, "bin", "index.js"))).toBe(true);

      const env = {
        ...process.env,
        HASNA_HOOKS_DATA_DIR: join(prefix, "home", ".hasna", "hooks"),
        // Explicit local-mode opt-in (fleet fail-closed doctrine): this test
        // syncs the foreign prefix's bundled catalog into its local store on
        // purpose, with no registry API configured.
        HASNA_HOOKS_LOCAL: "1",
        NO_COLOR: "1",
      };

      const sync = Bun.spawnSync(["bun", join(prefix, "bin", "index.js"), "sync"], {
        cwd: tmpdir(),
        env,
      });
      expect(sync.exitCode, sync.stderr.toString()).toBe(0);
      expect(sync.stdout.toString()).toContain("Synced");
      const dataDir = join(prefix, "home", ".hasna", "hooks");
      const prevDataDir = process.env.HASNA_HOOKS_DATA_DIR;
      process.env.HASNA_HOOKS_DATA_DIR = dataDir;
      try {
        const lock = readLock();
        expect(lock.hooks["pre-bash"]).toBeTruthy();
      } finally {
        if (prevDataDir === undefined) delete process.env.HASNA_HOOKS_DATA_DIR;
        else process.env.HASNA_HOOKS_DATA_DIR = prevDataDir;
      }

      const run = Bun.spawnSync(["bun", join(prefix, "bin", "index.js"), "run", "pre-bash"], {
        cwd: tmpdir(),
        stdin: "ignore",
        env,
      });
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      const stdout = run.stdout.toString();
      expect(stdout).toContain('"continue":true');
      expect(stdout).toContain('"foreign-prefix"');

      const missing = Bun.spawnSync(["bun", join(prefix, "bin", "index.js"), "run", "pre-bash-absent"], {
        cwd: tmpdir(),
        stdin: "ignore",
        env,
      });
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr.toString()).toContain("'pre-bash-absent' not found");
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });
});
