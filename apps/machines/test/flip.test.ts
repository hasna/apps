import { describe, expect, test } from "bun:test";
import type { FleetManifest } from "../src/types.js";
import {
  FLIP_APPS,
  buildFlipPlan,
  buildFlipScript,
  getFlipApp,
  listFlipApps,
  planWaves,
  runFlip,
  runFreezeCheck,
  selectTargets,
  verifyStorageMode,
  type FlipTarget,
  type RunnerFn,
} from "../src/commands/flip.js";

const manifest: FleetManifest = {
  version: 1,
  machines: [
    { id: "apple01", platform: "macos", workspacePath: "/x", tags: ["macos", "lan"] },
    { id: "apple03", platform: "macos", workspacePath: "/x", tags: ["macos"] },
    { id: "spark01", platform: "linux", workspacePath: "/x", tags: ["linux"] },
    { id: "station02", platform: "linux", workspacePath: "/x", tags: ["linux", "lan"] },
  ],
};

describe("flip registry", () => {
  test("every app has consistent env + secret conventions", () => {
    for (const spec of listFlipApps()) {
      expect(spec.modeEnv).toBe(`HASNA_${spec.app.toUpperCase()}_STORAGE_MODE`);
      expect(spec.databaseUrlEnv).toBe(`HASNA_${spec.app.toUpperCase()}_DATABASE_URL`);
      expect(spec.databaseUrlSecretPath).toBe(`hasna/oss/${spec.app}/database-url`);
      expect(spec.serviceUnit).toContain(spec.app);
      expect(spec.statusArgs).toContain("--json");
    }
  });

  test("todos requires a freeze and carries the sanctioned shadow flag", () => {
    const todos = getFlipApp("todos");
    expect(todos.freezeRequired).toBe(true);
    expect(todos.extraRemoteEnv?.HASNA_TODOS_SHADOW).toBe("1");
  });

  test("unknown app throws", () => {
    expect(() => getFlipApp("nope")).toThrow(/Unknown flip app/);
  });
});

describe("target selection", () => {
  test("returns all machines in manifest order by default", () => {
    expect(selectTargets(manifest).map((t) => t.id)).toEqual(["apple01", "apple03", "spark01", "station02"]);
  });
  test("filters by explicit ids", () => {
    expect(selectTargets(manifest, { machines: ["spark01"] }).map((t) => t.id)).toEqual(["spark01"]);
  });
  test("filters by tags (AND) and excludes", () => {
    expect(selectTargets(manifest, { tags: ["lan"], exclude: ["apple01"] }).map((t) => t.id)).toEqual(["station02"]);
  });
});

describe("wave planning", () => {
  const targets: FlipTarget[] = selectTargets(manifest);
  test("canary first, then batches, covering every target exactly once", () => {
    const waves = planWaves(targets, { canarySize: 1, batchSize: 2 });
    expect(waves[0]?.name).toBe("canary");
    expect(waves[0]?.targets.map((t) => t.id)).toEqual(["apple01"]);
    const seen = waves.flatMap((w) => w.targets.map((t) => t.id));
    expect(seen).toEqual(["apple01", "apple03", "spark01", "station02"]);
  });
  test("empty target list yields no waves", () => {
    expect(planWaves([])).toEqual([]);
  });
});

describe("script generation", () => {
  const spec = getFlipApp("todos");

  test("remote script fetches DSN from the secret store and never inlines a value", () => {
    const script = buildFlipScript(spec, "remote");
    expect(script).toContain("secrets get 'hasna/oss/todos/database-url'");
    expect(script).toContain("HASNA_TODOS_STORAGE_MODE=remote");
    expect(script).toContain("HASNA_TODOS_SHADOW=1");
    // The DSN must only ever be a shell variable, never a literal.
    expect(script).not.toMatch(/postgres:\/\//i);
    expect(script).toContain('chmod 600');
    // Verification markers present.
    expect(script).toContain("FLIP_STATUS_BEGIN");
    expect(script).toContain("todos storage status --json");
  });

  test("remote script aborts when the secret cannot be resolved", () => {
    const script = buildFlipScript(spec, "remote");
    expect(script).toContain("FLIP_ERROR: could not resolve DSN secret");
    expect(script).toContain("exit 3");
  });

  test("local (revert) script pins local mode and drops the DSN", () => {
    const script = buildFlipScript(spec, "local");
    expect(script).toContain("HASNA_TODOS_STORAGE_MODE=local");
    expect(script).not.toContain("secrets get");
    expect(script).not.toContain("HASNA_TODOS_DATABASE_URL");
  });

  test("wires both systemd and launchd", () => {
    const script = buildFlipScript(spec, "remote");
    expect(script).toContain("systemctl --user restart");
    expect(script).toContain("launchctl kickstart");
    expect(script).toContain("10-cloud-flip.conf");
  });

  test("skipRestart omits the service wiring", () => {
    const script = buildFlipScript(spec, "remote", { skipRestart: true });
    expect(script).not.toContain("systemctl --user restart");
  });
});

describe("verification", () => {
  test("accepts remote status", () => {
    const out = `noise\nFLIP_STATUS_BEGIN\n{"mode":"remote","remote_enabled":true}\nFLIP_STATUS_END`;
    const v = verifyStorageMode(out, "remote");
    expect(v.ok).toBe(true);
    expect(v.observedMode).toBe("remote");
  });
  test("rejects local status when remote expected", () => {
    const out = `{"mode":"local","remote_enabled":false}`;
    expect(verifyStorageMode(out, "remote").ok).toBe(false);
  });
  test("accepts local status on revert", () => {
    const out = `{"mode":"local","remote_enabled":false}`;
    expect(verifyStorageMode(out, "local").ok).toBe(true);
  });
  test("fails cleanly on unparseable output", () => {
    expect(verifyStorageMode("boom", "remote").ok).toBe(false);
  });
});

describe("freeze check", () => {
  const spec = getFlipApp("todos");
  const okRunner: RunnerFn = () => ({ stdout: "", stderr: "", exitCode: 0 });
  const failRunner: RunnerFn = () => ({ stdout: "", stderr: "writers still active", exitCode: 1 });

  test("freeze-required app without a command is blocked", () => {
    expect(runFreezeCheck(spec, okRunner, { machineId: "spark01" }).ok).toBe(false);
  });
  test("passes when freeze command succeeds", () => {
    expect(runFreezeCheck(spec, okRunner, { machineId: "spark01", freezeCommand: "todos-freeze" }).ok).toBe(true);
  });
  test("fails when freeze command fails", () => {
    const r = runFreezeCheck(spec, failRunner, { machineId: "spark01", freezeCommand: "todos-freeze" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("freeze check failed");
  });
  test("non-freeze app passes trivially", () => {
    expect(runFreezeCheck(getFlipApp("knowledge"), failRunner, { machineId: "spark01" }).ok).toBe(true);
  });
});

describe("orchestration", () => {
  const knowledge = getFlipApp("knowledge");
  const targets = selectTargets(manifest);
  const waves = planWaves(targets, { canarySize: 1, batchSize: 2 });

  test("dry-run executes nothing and marks every target", () => {
    let calls = 0;
    const runner: RunnerFn = () => {
      calls += 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const report = runFlip({ spec: knowledge, mode: "remote", waves, runner, execute: false });
    expect(calls).toBe(0);
    expect(report.results).toHaveLength(4);
    expect(report.results.every((r) => !r.applied)).toBe(true);
  });

  test("execute verifies each machine and completes when all pass", () => {
    const runner: RunnerFn = () => ({
      stdout: `FLIP_STATUS_BEGIN{"mode":"remote","remote_enabled":true}FLIP_STATUS_END`,
      stderr: "",
      exitCode: 0,
    });
    const report = runFlip({ spec: knowledge, mode: "remote", waves, runner, execute: true });
    expect(report.aborted).toBe(false);
    expect(report.results.every((r) => r.verification.ok)).toBe(true);
  });

  test("a failing canary halts before the next wave", () => {
    let seen = 0;
    const runner: RunnerFn = () => {
      seen += 1;
      // canary machine reports still-local -> verification fails
      return { stdout: `{"mode":"local","remote_enabled":false}`, stderr: "not flipped", exitCode: 0 };
    };
    const report = runFlip({ spec: knowledge, mode: "remote", waves, runner, execute: true });
    expect(report.aborted).toBe(true);
    expect(seen).toBe(1); // only the canary ran
    expect(report.results).toHaveLength(1);
  });

  test("freeze-required app aborts the flip when no freeze command is given", () => {
    const runner: RunnerFn = () => ({ stdout: "", stderr: "", exitCode: 0 });
    const report = runFlip({ spec: getFlipApp("todos"), mode: "remote", waves, runner, execute: true });
    expect(report.aborted).toBe(true);
    expect(report.results[0]?.error).toContain("requires --freeze-check");
  });
});

describe("plan", () => {
  test("plan lists waves and referenced secret paths without values", () => {
    const spec = getFlipApp("mementos");
    const waves = planWaves(selectTargets(manifest), { canarySize: 1, batchSize: 2 });
    const plan = buildFlipPlan(spec, "remote", waves);
    expect(plan.secretPathsReferenced).toEqual(["hasna/oss/mementos/database-url"]);
    expect(plan.waves[0]?.machines).toEqual(["apple01"]);
    expect(Object.keys(FLIP_APPS)).toContain(plan.app);
  });
});
