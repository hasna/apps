import { describe, expect, test } from "bun:test";
import type { FleetManifest } from "../src/types.js";
import {
  FLIP_APPS,
  buildFlipPlan,
  buildFlipScript,
  getFlipApp,
  listFlipApps,
  normalizeFlipMode,
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
  test("registers all 25 @hasna OSS apps", () => {
    expect(Object.keys(FLIP_APPS).length).toBe(25);
    for (const app of [
      "accounts", "attachments", "calendar", "contacts", "conversations", "domains",
      "economy", "files", "identities", "instructions", "knowledge", "logs", "loops",
      "machines", "mailery", "mementos", "projects", "recordings", "sandboxes", "secrets",
      "sessions", "shortlinks", "telephony", "testers", "todos",
    ]) {
      expect(FLIP_APPS[app]).toBeDefined();
    }
  });

  test("every app uses API-URL + API-KEY env + hasna/oss/<app>/api-key secret (never a DSN)", () => {
    for (const spec of listFlipApps()) {
      const UP = spec.app.toUpperCase();
      expect(spec.apiUrlEnv).toBe(`HASNA_${UP}_API_URL`);
      expect(spec.apiKeyEnv).toBe(`HASNA_${UP}_API_KEY`);
      expect(spec.apiUrl).toBe(`https://${spec.app}.hasna.xyz`);
      expect(spec.apiKeySecretPath).toBe(`hasna/oss/${spec.app}/api-key`);
      expect(spec.serviceUnit).toContain(spec.app);
      expect(spec.statusArgs).toContain("--json");
      // No legacy DSN / STORAGE_MODE surface may exist on the spec.
      expect((spec as Record<string, unknown>).databaseUrlEnv).toBeUndefined();
      expect((spec as Record<string, unknown>).modeEnv).toBeUndefined();
    }
  });

  test("coordination hot stores require a freeze before flip", () => {
    for (const app of ["todos", "loops", "mementos", "conversations"]) {
      expect(getFlipApp(app).freezeRequired).toBe(true);
    }
    expect(getFlipApp("knowledge").freezeRequired).toBeUndefined();
  });

  test("unknown app throws", () => {
    expect(() => getFlipApp("nope")).toThrow(/Unknown flip app/);
  });
});

describe("mode normalization", () => {
  test("maps cloud/remote/api/on aliases to self_hosted", () => {
    for (const v of ["self_hosted", "remote", "cloud", "api", "on", undefined]) {
      expect(normalizeFlipMode(v)).toBe("self_hosted");
    }
  });
  test("maps local/revert/off to local", () => {
    for (const v of ["local", "revert", "off"]) {
      expect(normalizeFlipMode(v)).toBe("local");
    }
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
  test("atomic (--all-machines) puts every target in a single wave", () => {
    const waves = planWaves(targets, { atomic: true });
    expect(waves).toHaveLength(1);
    expect(waves[0]?.name).toBe("all-machines");
    expect(waves[0]?.targets.map((t) => t.id)).toEqual(["apple01", "apple03", "spark01", "station02"]);
  });
  test("empty target list yields no waves", () => {
    expect(planWaves([])).toEqual([]);
  });
});

describe("script generation", () => {
  const spec = getFlipApp("todos");

  test("self_hosted script writes API_URL + API_KEY, fetches the key from the secret store, never a DSN", () => {
    const script = buildFlipScript(spec, "self_hosted");
    expect(script).toContain("secrets get 'hasna/oss/todos/api-key'");
    expect(script).toContain("HASNA_TODOS_API_URL=https://todos.hasna.xyz");
    expect(script).toContain("HASNA_TODOS_API_KEY");
    // Forbidden legacy surfaces must never appear.
    expect(script).not.toContain("STORAGE_MODE=remote");
    expect(script).not.toContain("DATABASE_URL");
    expect(script).not.toMatch(/postgres:\/\//i);
    // The key must only ever be a shell variable, never a literal.
    expect(script).toContain('chmod 600');
    // Verification markers present.
    expect(script).toContain("FLIP_STATUS_BEGIN");
    expect(script).toContain("todos storage status --json");
  });

  test("self_hosted script aborts when the API-key secret cannot be resolved", () => {
    const script = buildFlipScript(spec, "self_hosted");
    expect(script).toContain("FLIP_ERROR: could not resolve API key secret");
    expect(script).toContain("exit 3");
  });

  test("local (revert) script removes the env file and never touches the secret", () => {
    const script = buildFlipScript(spec, "local");
    expect(script).toContain('rm -f "$ENV_FILE"');
    expect(script).not.toContain("secrets get");
    expect(script).not.toContain("HASNA_TODOS_API_KEY=");
    // Revert removes the systemd drop-in so both vars are fully unset.
    expect(script).toContain("rm -f");
  });

  test("wires both systemd and launchd", () => {
    const script = buildFlipScript(spec, "self_hosted");
    expect(script).toContain("systemctl --user restart");
    expect(script).toContain("launchctl kickstart");
    expect(script).toContain("10-cloud-flip.conf");
  });

  test("revert unsets both vars in launchd and removes the systemd drop-in", () => {
    const script = buildFlipScript(spec, "local");
    expect(script).toContain('launchctl unsetenv "$API_URL_ENV"');
    expect(script).toContain('launchctl unsetenv "$API_KEY_ENV"');
    expect(script).toContain('rm -f "${DROPIN_DIR}/10-cloud-flip.conf"');
  });

  test("skipRestart omits the service wiring", () => {
    const script = buildFlipScript(spec, "self_hosted", { skipRestart: true });
    expect(script).not.toContain("systemctl --user restart");
  });
});

describe("verification", () => {
  test("accepts self_hosted status (api_enabled)", () => {
    const out = `noise\nFLIP_STATUS_BEGIN\n{"mode":"self_hosted","api_enabled":true}\nFLIP_STATUS_END`;
    const v = verifyStorageMode(out, "self_hosted");
    expect(v.ok).toBe(true);
    expect(v.observedMode).toBe("self_hosted");
  });
  test("accepts legacy remote_enabled boolean too", () => {
    const out = `{"mode":"self_hosted","remote_enabled":true}`;
    expect(verifyStorageMode(out, "self_hosted").ok).toBe(true);
  });
  test("rejects local status when self_hosted expected", () => {
    const out = `{"mode":"local","api_enabled":false}`;
    expect(verifyStorageMode(out, "self_hosted").ok).toBe(false);
  });
  test("accepts local status on revert", () => {
    const out = `{"mode":"local","api_enabled":false}`;
    expect(verifyStorageMode(out, "local").ok).toBe(true);
  });
  test("fails cleanly on unparseable output", () => {
    expect(verifyStorageMode("boom", "self_hosted").ok).toBe(false);
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
    const report = runFlip({ spec: knowledge, mode: "self_hosted", waves, runner, execute: false });
    expect(calls).toBe(0);
    expect(report.results).toHaveLength(4);
    expect(report.results.every((r) => !r.applied)).toBe(true);
  });

  test("execute verifies each machine and completes when all pass", () => {
    const runner: RunnerFn = () => ({
      stdout: `FLIP_STATUS_BEGIN{"mode":"self_hosted","api_enabled":true}FLIP_STATUS_END`,
      stderr: "",
      exitCode: 0,
    });
    const report = runFlip({ spec: knowledge, mode: "self_hosted", waves, runner, execute: true });
    expect(report.aborted).toBe(false);
    expect(report.results.every((r) => r.verification.ok)).toBe(true);
  });

  test("atomic --all-machines wave flips every machine together", () => {
    const atomicWaves = planWaves(targets, { atomic: true });
    const seen: string[] = [];
    const runner: RunnerFn = (id) => {
      seen.push(id);
      return { stdout: `{"mode":"self_hosted","api_enabled":true}`, stderr: "", exitCode: 0 };
    };
    const report = runFlip({ spec: knowledge, mode: "self_hosted", waves: atomicWaves, runner, execute: true });
    expect(report.aborted).toBe(false);
    expect(seen).toEqual(["apple01", "apple03", "spark01", "station02"]);
    expect(report.results).toHaveLength(4);
  });

  test("a failing canary halts before the next wave", () => {
    let seen = 0;
    const runner: RunnerFn = () => {
      seen += 1;
      // canary machine reports still-local -> verification fails
      return { stdout: `{"mode":"local","api_enabled":false}`, stderr: "not flipped", exitCode: 0 };
    };
    const report = runFlip({ spec: knowledge, mode: "self_hosted", waves, runner, execute: true });
    expect(report.aborted).toBe(true);
    expect(seen).toBe(1); // only the canary ran
    expect(report.results).toHaveLength(1);
  });

  test("freeze-required app aborts the flip when no freeze command is given", () => {
    const runner: RunnerFn = () => ({ stdout: "", stderr: "", exitCode: 0 });
    const report = runFlip({ spec: getFlipApp("todos"), mode: "self_hosted", waves, runner, execute: true });
    expect(report.aborted).toBe(true);
    expect(report.results[0]?.error).toContain("requires --freeze-check");
  });
});

describe("plan", () => {
  test("plan lists waves and referenced api-key secret paths without values", () => {
    const spec = getFlipApp("mementos");
    const waves = planWaves(selectTargets(manifest), { canarySize: 1, batchSize: 2 });
    const plan = buildFlipPlan(spec, "self_hosted", waves);
    expect(plan.secretPathsReferenced).toEqual(["hasna/oss/mementos/api-key"]);
    expect(plan.waves[0]?.machines).toEqual(["apple01"]);
    expect(Object.keys(FLIP_APPS)).toContain(plan.app);
  });
  test("revert plan references no secrets", () => {
    const plan = buildFlipPlan(getFlipApp("mementos"), "local", planWaves(selectTargets(manifest)));
    expect(plan.secretPathsReferenced).toEqual([]);
  });
});
