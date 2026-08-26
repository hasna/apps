import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FleetManifest } from "../src/types.js";
import {
  FLIP_APPS,
  buildFlipPlan,
  buildFlipScript,
  extractFlipSha256,
  extractFlipUnitEnvFiles,
  getFlipApp,
  listFlipApps,
  normalizeFlipMode,
  planWaves,
  runFlip,
  runFreezeCheck,
  selectTargets,
  verifyFlipProvenance,
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

function writeExecutable(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function runWithFixturePath(script: string, binDir: string, env: NodeJS.ProcessEnv) {
  // Bun prepends its own install paths to PATH for node:child_process spawns.
  // Start with a clean environment and pass only the fixture inputs so no
  // installed Hasna CLI can win command lookup in the child.
  return spawnSync(
    "/usr/bin/env",
    ["-i", `CALL_LOG=${env.CALL_LOG ?? ""}`, `PATH=${binDir}:/usr/bin:/bin`, "bash", "-c", script],
    { encoding: "utf8" },
  );
}

describe("flip registry", () => {
  test("registers all 25 @hasna OSS apps (emails in, retired mailery out)", () => {
    expect(Object.keys(FLIP_APPS).length).toBe(25);
    for (const app of [
      "accounts", "attachments", "calendar", "contacts", "conversations", "domains",
      "economy", "emails", "files", "identities", "instructions", "knowledge", "logs",
      "loops", "machines", "mementos", "projects", "recordings", "sandboxes", "secrets",
      "sessions", "shortlinks", "telephony", "testers", "todos",
    ]) {
      expect(FLIP_APPS[app]).toBeDefined();
    }
    // Mailery is a separate, unrelated SaaS product (retired from the client
    // flips route 2026-08-19); it must not be flip-registered.
    expect(FLIP_APPS["mailery"]).toBeUndefined();
  });

  test("every app uses API-URL + API-KEY env + hasna/oss/<app>/api-key secret (never a DSN)", () => {
    for (const spec of listFlipApps()) {
      if (spec.keyViaSecretPointer) continue; // emails deviates by contract (checked below).
      const UP = spec.app.toUpperCase();
      expect(spec.apiUrlEnv).toBe(`HASNA_${UP}_API_URL`);
      expect(spec.apiKeyEnv).toBe(`HASNA_${UP}_API_KEY`);
      expect(spec.apiUrl).toBe(`https://${spec.app}.your-deployment.example`);
      expect(spec.apiKeySecretPath).toBe(`hasna/oss/${spec.app}/api-key`);
      expect(spec.serviceUnit).toContain(spec.app);
      expect(spec.statusArgs).toContain("--json");
      // No legacy DSN / STORAGE_MODE surface may exist on the spec.
      expect((spec as Record<string, unknown>).databaseUrlEnv).toBeUndefined();
      expect((spec as Record<string, unknown>).modeEnv).toBeUndefined();
    }
  });

  test("emails has the fleet-hosted contract: SELF_HOSTED_URL + Vault pointer, never a literal key", () => {
    const spec = getFlipApp("emails");
    expect(spec.apiUrlEnv).toBe("EMAILS_SELF_HOSTED_URL");
    expect(spec.apiUrl).toBe("https://emails.your-deployment.example");
    expect(spec.apiKeyEnv).toBe("EMAILS_CLIENT_ENV_SECRET");
    expect(spec.apiKeySecretPath).toBe("hasna/xyz/opensource/emails/live/client-env");
    expect(spec.keyViaSecretPointer).toBe(true);
    expect(spec.verifyModePath).toBe("mode.current");
    expect(spec.serviceUnit).toContain("emails");
    expect(spec.cliBin).toBe("emails");
    expect(spec.statusArgs).toContain("--json");
    expect((spec as Record<string, unknown>).databaseUrlEnv).toBeUndefined();
    expect((spec as Record<string, unknown>).modeEnv).toBeUndefined();
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
  test("maps api/cloud/on (and the default) to api", () => {
    for (const v of ["api", "cloud", "on", undefined]) {
      expect(normalizeFlipMode(v)).toBe("api");
    }
  });
  test("maps local/revert/off to local", () => {
    for (const v of ["local", "revert", "off"]) {
      expect(normalizeFlipMode(v)).toBe("local");
    }
  });
  test("rejects the retired deployment-mode words loudly", () => {
    // Deployment modes were removed (owner directive 2026-07-29); a flip
    // invoked with the old vocabulary must fail with the replacement named,
    // never be silently remapped.
    for (const v of ["self_hosted", "self-hosted", "remote", "hybrid"]) {
      expect(() => normalizeFlipMode(v)).toThrow(/retired/);
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

  test("captured default get is empty, while the generated script consumes the key through exec", () => {
    const root = mkdtempSync(join(tmpdir(), "machines-flip-secrets-"));
    try {
      const binDir = join(root, "bin");
      const envDir = join(root, "cloud");
      const callLog = join(root, "calls.log");
      const captured = join(root, "captured-default-get");
      mkdirSync(binDir);

      writeExecutable(
        binDir,
        "secrets",
        [
          'printf "%s\\n" "${1:-}" >> "$CALL_LOG"',
          'if [ "${1:-}" = "get" ]; then',
          '  for arg in "$@"; do [ "$arg" = "--show" ] && { printf x; exit 0; }; done',
          '  printf "%s\\n" "captured get refused" >&2',
          "  exit 9",
          "fi",
          '[ "${1:-}" = "exec" ] || exit 64',
          "shift",
          "shift",
          '[ "${1:-}" = "--as" ] || exit 65',
          'env_name="${2:-}"',
          "shift 2",
          '[ "${1:-}" = "--" ] || exit 66',
          "shift",
          'export "$env_name=x"',
          'exec "$@"',
        ].join("\n"),
      );
      writeExecutable(binDir, "todos", "printf '%s\\n' '{\"mode\":\"cloud\",\"api_enabled\":true}'");

      const env = { ...process.env, CALL_LOG: callLog, PATH: `${binDir}:/usr/bin:/bin` };
      const rejectedCapture = spawnSync(
        "/usr/bin/env",
        ["-i", `CALL_LOG=${callLog}`, `PATH=${binDir}:/usr/bin:/bin`, "sh", "-c", 'secrets get fixture/key > "$1"', "fixture", captured],
        { encoding: "utf8" },
      );
      expect(rejectedCapture.status).toBe(9);
      expect(statSync(captured).size).toBe(0);

      const script = buildFlipScript(spec, "api", { envDir, skipRestart: true });
      const result = runWithFixturePath(script, binDir, env);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(callLog, "utf8")).toBe("get\nexec\n");
      expect(script).toContain("secrets exec 'hasna/oss/todos/api-key' --as API_KEY -- sh -c");
      expect(script).not.toContain("secrets get");

      const rendered = readFileSync(join(envDir, "todos.env"), "utf8");
      const keyLine = rendered.match(/^HASNA_TODOS_API_KEY=(.+)$/m);
      expect(keyLine).not.toBeNull();
      expect(keyLine?.[1]?.length).toBeGreaterThan(0);

      const failingEnvDir = join(root, "failing-cloud");
      mkdirSync(failingEnvDir);
      writeExecutable(binDir, "mv", "exit 71");
      const failingScript = buildFlipScript(spec, "api", { envDir: failingEnvDir, skipRestart: true });
      const failedMove = runWithFixturePath(failingScript, binDir, env);
      expect(failedMove.status).toBe(71);
      expect(readdirSync(failingEnvDir).filter((name) => name.startsWith(".todos.env."))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("api script writes API_URL + API_KEY, fetches the key from the secret store, never a DSN", () => {
    const script = buildFlipScript(spec, "api");
    expect(script).toContain("secrets exec 'hasna/oss/todos/api-key' --as API_KEY -- sh -c");
    expect(script).not.toContain("secrets get");
    expect(script).not.toContain("--show");
    expect(script).not.toContain("--plaintext");
    expect(script).toContain("HASNA_TODOS_API_URL=https://todos.your-deployment.example");
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

  test("api script aborts when the API-key secret cannot be resolved", () => {
    const script = buildFlipScript(spec, "api");
    expect(script).toContain("FLIP_ERROR: could not resolve API key secret");
    expect(script).toContain("exit 3");
  });

  test("the secret handoff does not capture stdout or discard its failure signal", () => {
    const script = buildFlipScript(spec, "api");
    expect(script).toContain("secrets exec 'hasna/oss/todos/api-key' --as API_KEY -- sh -c");
    expect(script).not.toMatch(new RegExp("API_" + "KEY=.*secrets get"));
    expect(script).not.toMatch(/secrets exec[^\n]*2>\/dev\/null/);
  });

  test("local (revert) script removes the env file and never touches the secret", () => {
    const script = buildFlipScript(spec, "local");
    expect(script).toContain('rm -f "$ENV_FILE"');
    expect(script).not.toContain("secrets get");
    expect(script).not.toContain("secrets exec");
    expect(script).not.toContain("HASNA_TODOS_API_KEY=");
    // Revert removes the systemd drop-in so both vars are fully unset.
    expect(script).toContain("rm -f");
  });

  test("wires both systemd and launchd", () => {
    const script = buildFlipScript(spec, "api");
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
    const script = buildFlipScript(spec, "api", { skipRestart: true });
    expect(script).not.toContain("systemctl --user restart");
  });

  test("emails api script writes the URL + Vault pointer and never fetches a literal key", () => {
    const script = buildFlipScript(getFlipApp("emails"), "api");
    expect(script).toContain("EMAILS_SELF_HOSTED_URL=https://emails.your-deployment.example");
    expect(script).toContain("EMAILS_CLIENT_ENV_SECRET=hasna/xyz/opensource/emails/live/client-env");
    // No on-target secret fetch and no generic HASNA_* emails keys.
    expect(script).not.toContain("secrets exec");
    expect(script).not.toContain("secrets get");
    expect(script).not.toContain("HASNA_EMAILS_API_URL");
    expect(script).not.toContain("HASNA_EMAILS_API_KEY");
    expect(script).not.toContain("STORAGE_MODE");
    // The only EMAILS_CLIENT_ENV_SECRET assignment is the Vault pointer (path),
    // never a resolved key value.
    expect(script.split("EMAILS_CLIENT_ENV_SECRET=").length - 1).toBe(1);
    expect(script).toContain("EMAILS_CLIENT_ENV_SECRET=hasna/xyz/opensource/emails/live/client-env");
    expect(script).toContain('chmod 600');
    expect(script).toContain("FLIP_STATUS_BEGIN");
    expect(script).toContain("emails status --json");
    // Revert simply removes the env file; both emails vars are covered by the
    // generic wiring (API_URL_ENV / API_KEY_ENV carry the EMAILS_* names).
    const revertScript = buildFlipScript(getFlipApp("emails"), "local");
    expect(revertScript).toContain('rm -f "$ENV_FILE"');
    expect(revertScript).toContain("EMAILS_SELF_HOSTED_URL");
    expect(revertScript).toContain("EMAILS_CLIENT_ENV_SECRET");
    expect(revertScript).toContain('launchctl unsetenv "$API_URL_ENV"');
    expect(revertScript).toContain('launchctl unsetenv "$API_KEY_ENV"');
  });
});

describe("env-contract verification (incident 715712)", () => {
  // Regression: a harness session-env re-provision on station01 dropped the
  // hosted API env for TODOS/KNOWLEDGE/EMAILS; emails.env ended up carrying
  // ONLY the pointer (EMAILES_CLIENT_ENV_SECRET), and the CLIs silently fell
  // back to empty on-box SQLite stores at rc=0. Every api-mode provision must
  // therefore (re)write the FULL per-app env contract and verify it on-target
  // before the session starts.

  test("emails api provision writes URL + Vault pointer and the written env file carries the full contract", () => {
    const root = mkdtempSync(join(tmpdir(), "machines-flip-envverify-"));
    try {
      const binDir = join(root, "bin");
      const envDir = join(root, "cloud");
      mkdirSync(binDir);
      writeExecutable(binDir, "emails", "printf '%s\\n' '{\"mode\":\"cloud\",\"api_enabled\":true}'");
      const env = { ...process.env, PATH: `${binDir}:/usr/bin:/bin` };

      const script = buildFlipScript(getFlipApp("emails"), "api", { envDir, skipRestart: true });
      const result = runWithFixturePath(script, binDir, env);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const emailsEnv = readFileSync(join(envDir, "emails.env"), "utf8");
      // The station01 divergence was a pointer-ONLY emails.env. The written
      // file must always carry BOTH the hosted URL and the pointer.
      expect(emailsEnv).toContain("EMAILS_SELF_HOSTED_URL=");
      expect(emailsEnv).toContain("EMAILS_CLIENT_ENV_SECRET=");
      expect(emailsEnv).toMatch(/^EMAILS_SELF_HOSTED_URL=https:\/\/emails\.your-deployment\.example$/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("api provision aborts (rc=3) when the required env contract is not fully written, leaving no reduced env file", () => {
    const root = mkdtempSync(join(tmpdir(), "machines-flip-envverify-"));
    try {
      const binDir = join(root, "bin");
      const envDir = join(root, "cloud");
      mkdirSync(binDir);
      writeExecutable(binDir, "emails", "printf '%s\\n' '{\"mode\":\"cloud\",\"api_enabled\":true}'");
      const env = { ...process.env, PATH: `${binDir}:/usr/bin:/bin` };
      // A spec whose required contract includes a key the pointer branch does
      // not write (EMAILS_MODE is part of the emails client-env VAULT entry,
      // never the flip env file) must abort BEFORE the reduced file becomes
      // the provisioned state — a re-provision can never emit a reduced env.
      const demanding = {
        ...getFlipApp("emails"),
        clientEnvRequiredKeys: ["EMAILS_SELF_HOSTED_URL", "EMAILS_CLIENT_ENV_SECRET", "EMAILS_MODE"],
      } as FlipAppSpec;
      const result = runWithFixturePath(
        buildFlipScript(demanding, "api", { envDir, skipRestart: true }),
        binDir,
        env,
      );
      expect(result.status).toBe(3);
      expect(result.stderr).toContain("FLIP_ERROR");
      expect(result.stderr).toContain("EMAILS_MODE");
      // The incomplete env file must not survive as the provisioned state.
      expect(existsSync(join(envDir, "emails.env"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verification", () => {
  test("accepts an api-backed status (mode=cloud + api_enabled)", () => {
    const out = `noise\nFLIP_STATUS_BEGIN\n{"mode":"cloud","api_enabled":true}\nFLIP_STATUS_END`;
    const v = verifyStorageMode(out, "api");
    expect(v.ok).toBe(true);
    expect(v.observedMode).toBe("cloud");
  });
  test("accepts a status from an older installed CLI that still reports a retired mode word", () => {
    // Read-side compat only: the fleet updates in waves, so a not-yet-updated
    // app may still SAY self_hosted in its status JSON. We accept the report
    // as api-backed; we never emit the word ourselves.
    expect(verifyStorageMode(`{"mode":"self_hosted","api_enabled":true}`, "api").ok).toBe(true);
  });
  test("accepts legacy remote_enabled boolean too", () => {
    const out = `{"mode":"cloud","remote_enabled":true}`;
    expect(verifyStorageMode(out, "api").ok).toBe(true);
  });
  test("rejects local status when api expected", () => {
    const out = `{"mode":"local","api_enabled":false}`;
    expect(verifyStorageMode(out, "api").ok).toBe(false);
  });
  test("accepts local status on revert", () => {
    const out = `{"mode":"local","api_enabled":false}`;
    expect(verifyStorageMode(out, "local").ok).toBe(true);
  });
  test("fails cleanly on unparseable output", () => {
    expect(verifyStorageMode("boom", "api").ok).toBe(false);
  });

  test("emails verification reads mode.current (Server API == self_hosted)", () => {
    const emailsSpec = getFlipApp("emails");
    const hosted = `{"mode":{"current":"self_hosted","label":"Server API"}}`;
    const v = verifyStorageMode(hosted, "api", emailsSpec);
    expect(v.ok).toBe(true);
    expect(v.observedMode).toBe("self_hosted");
    // An unparseable payload still fails even for emails.
    expect(verifyStorageMode("boom", "api", emailsSpec).ok).toBe(false);
  });

  test("emails verification rejects local mode when api expected", () => {
    const emailsSpec = getFlipApp("emails");
    const local = `{"mode":{"current":"local"},"database":{"database_file":"/x/local.db"}}`;
    expect(verifyStorageMode(local, "api", emailsSpec).ok).toBe(false);
    expect(verifyStorageMode(local, "local", emailsSpec).ok).toBe(true);
  });

  test("verifyStorageMode keeps default root-level mode parsing when no spec is passed", () => {
    expect(verifyStorageMode(`{"mode":"cloud","api_enabled":true}`, "api").ok).toBe(true);
    expect(verifyStorageMode(`{"mode":"local","api_enabled":false}`, "local").ok).toBe(true);
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
    const report = runFlip({ spec: knowledge, mode: "api", waves, runner, execute: false });
    expect(calls).toBe(0);
    expect(report.results).toHaveLength(4);
    expect(report.results.every((r) => !r.applied)).toBe(true);
  });

  test("execute verifies each machine and completes when all pass", () => {
    const runner: RunnerFn = () => ({
      stdout: `FLIP_STATUS_BEGIN{"mode":"cloud","api_enabled":true,"apiKeyTier":"fleet-env","apiKeySource":"/home/u/.hasna/fleet-env/knowledge.env","apiUrlSource":"/home/u/.hasna/fleet-env/knowledge.env","transportSource":"/home/u/.hasna/fleet-env/knowledge.env"}FLIP_STATUS_END FLIP_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
      stderr: "",
      exitCode: 0,
    });
    const report = runFlip({ spec: knowledge, mode: "api", waves, runner, execute: true });
    expect(report.aborted).toBe(false);
    expect(report.results.every((r) => r.verification.ok)).toBe(true);
    // The ledger carries the provenance verdict and the env-file sha256.
    expect(report.ledger.every((e) => e.provenanceOk && e.result === "ok")).toBe(true);
    expect(report.ledger[0]?.envSha256).toBe("a".repeat(64));
  });

  test("atomic --all-machines wave flips every machine together", () => {
    const atomicWaves = planWaves(targets, { atomic: true });
    const seen: string[] = [];
    const runner: RunnerFn = (id) => {
      seen.push(id);
      return {
        stdout: `{"mode":"cloud","api_enabled":true,"apiKeyTier":"fleet-env","apiKeySource":"/home/u/.hasna/fleet-env/knowledge.env","apiUrlSource":"/home/u/.hasna/fleet-env/knowledge.env"} FLIP_SHA256=${"a".repeat(64)}`,
        stderr: "",
        exitCode: 0,
      };
    };
    const report = runFlip({ spec: knowledge, mode: "api", waves: atomicWaves, runner, execute: true });
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
    const report = runFlip({ spec: knowledge, mode: "api", waves, runner, execute: true });
    expect(report.aborted).toBe(true);
    expect(seen).toBe(1); // only the canary ran
    expect(report.results).toHaveLength(1);
  });

  test("freeze-required app aborts the flip when no freeze command is given", () => {
    const runner: RunnerFn = () => ({ stdout: "", stderr: "", exitCode: 0 });
    const report = runFlip({ spec: getFlipApp("todos"), mode: "api", waves, runner, execute: true });
    expect(report.aborted).toBe(true);
    expect(report.results[0]?.error).toContain("requires --freeze-check");
  });
});

describe("plan", () => {
  test("plan lists waves and referenced api-key secret paths without values", () => {
    const spec = getFlipApp("mementos");
    const waves = planWaves(selectTargets(manifest), { canarySize: 1, batchSize: 2 });
    const plan = buildFlipPlan(spec, "api", waves);
    expect(plan.secretPathsReferenced).toEqual(["hasna/oss/mementos/api-key"]);
    expect(plan.waves[0]?.machines).toEqual(["apple01"]);
    expect(Object.keys(FLIP_APPS)).toContain(plan.app);
  });
  test("revert plan references no secrets", () => {
    const plan = buildFlipPlan(getFlipApp("mementos"), "local", planWaves(selectTargets(manifest)));
    expect(plan.secretPathsReferenced).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P1-C provenance gates + per-run ledger (todos 0c0324c1, review P0-3 / Sol 5;
// release-review P1 remediation: per-app extraction + unit probe + revert
// ledger + ledger preflight).
// ---------------------------------------------------------------------------
describe("provenance gates (P1-C)", () => {
  const spec = getFlipApp("knowledge");
  const fleetEnv = "/home/u/.hasna/fleet-env/knowledge.env";
  const sha = (x: string) => x.repeat(64);

  test("positive: contracts-shaped fleet-env source + tier passes, sourceOfValue = the fleet file", () => {
    const out = `FLIP_STATUS_BEGIN{"mode":"http","api_enabled":true,"apiKeyTier":"disk","apiKeySource":"${fleetEnv}","apiUrlSource":"${fleetEnv}","transportSource":"${fleetEnv}"}FLIP_STATUS_END FLIP_SHA256=${sha("c")}`;
    const r = verifyFlipProvenance(out, spec, "api", { expectedEnvFile: fleetEnv });
    expect(r.provenanceOk).toBe(true);
    expect(r.sourceOfValue).toBe(fleetEnv);
    expect(r.envSha256).toBe(sha("c"));
  });

  test("positive: EMAILS real shape — mode.source.name is the fleet-env file (kind config)", () => {
    const emailsSpec = getFlipApp("emails");
    const emailsEnv = "/home/u/.hasna/fleet-env/emails.env";
    const out = `FLIP_STATUS_BEGIN{"mode":{"current":"self_hosted","label":"Server API","source":{"kind":"config","name":"${emailsEnv}","value":"https://emails.example.invalid"},"warning":null}}FLIP_STATUS_END FLIP_SHA256=${sha("d")}`;
    const r = verifyFlipProvenance(out, emailsSpec, "api", { expectedEnvFile: emailsEnv });
    expect(r.provenanceOk).toBe(true);
    expect(r.apiUrlSource).toBe(emailsEnv);
  });

  test("positive: TODOS real shape — remote_authority.api_url_source/api_key_source are the fleet-env file", () => {
    const todosSpec = getFlipApp("todos");
    const todosEnv = "/home/u/.hasna/fleet-env/todos.env";
    const out = `FLIP_STATUS_BEGIN{"mode":"http","remote_enabled":true,"remote_authority":{"selected":true,"ok":true,"transport":"http","api_url_source":"${todosEnv}","api_key_source":"${todosEnv}","v1_base_url":"https://todos.example.invalid/v1","issues":[]}}FLIP_STATUS_END FLIP_SHA256=${sha("e")}`;
    const r = verifyFlipProvenance(out, todosSpec, "api", { expectedEnvFile: todosEnv });
    expect(r.provenanceOk).toBe(true);
    expect(r.apiUrlSource).toBe(todosEnv);
    expect(r.apiKeySource).toBe(todosEnv);
  });

  test("positive: env-key-name sources pass when the unit probe proves EnvironmentFiles = the fleet-env file", () => {
    const out = [
      `FLIP_STATUS_BEGIN{"mode":"http","api_enabled":true,"apiKeySource":"HASNA_KNOWLEDGE_API_KEY","apiUrlSource":"HASNA_KNOWLEDGE_API_URL"}FLIP_STATUS_END`,
      `FLIP_SHA256=${sha("f")}`,
      "FLIP_UNIT_ENVFILES_FOUND=1",
      "FLIP_UNIT_ENVFILES=/etc/hasna/fleet-env/knowledge.env,/home/u/.hasna/fleet-env/knowledge.env",
    ].join("\n");
    const r = verifyFlipProvenance(out, spec, "api", { expectedEnvFile: fleetEnv });
    expect(r.provenanceOk).toBe(true);
    expect(r.sourceOfValue).toContain("fleet-env/knowledge.env");
  });

  test("negative: api mode without FLIP_SHA256 is rejected (file not proven written)", () => {
    const out = `{"mode":"http","api_enabled":true,"apiKeySource":"${fleetEnv}","apiUrlSource":"${fleetEnv}"}`;
    const r = verifyFlipProvenance(out, spec, "api", { expectedEnvFile: fleetEnv });
    expect(r.provenanceOk).toBe(false);
    expect(r.reason).toContain("FLIP_SHA256");
  });

  test("negative: apiKeyTier=legacy-env is rejected (the key did not come from the file)", () => {
    const out = `{"mode":"http","api_enabled":true,"apiKeyTier":"legacy-env","apiKeySource":null,"apiUrlSource":"${fleetEnv}"} FLIP_SHA256=${sha("a")}`;
    const r = verifyFlipProvenance(out, spec, "api", { expectedEnvFile: fleetEnv });
    expect(r.provenanceOk).toBe(false);
    expect(r.reason).toContain("legacy-env");
  });

  test("negative: a source under ~/.hasna/cloud is rejected", () => {
    const out = `{"mode":"http","api_enabled":true,"apiKeyTier":"disk","apiKeySource":"/home/u/.hasna/cloud/knowledge.env","apiUrlSource":"/home/u/.hasna/cloud/knowledge.env"} FLIP_SHA256=${sha("b")}`;
    const r = verifyFlipProvenance(out, spec, "api", { expectedEnvFile: fleetEnv });
    expect(r.provenanceOk).toBe(false);
    expect(r.reason).toContain(".hasna/cloud");
  });

  test("negative: api mode with sha but no reported source and no unit probe is rejected", () => {
    const out = `{"mode":"http","api_enabled":true} FLIP_SHA256=${sha("9")}`;
    const r = verifyFlipProvenance(out, spec, "api", { expectedEnvFile: fleetEnv });
    expect(r.provenanceOk).toBe(false);
    expect(r.reason).toContain("exact source cannot be confirmed");
  });

  test("negative: TODOS real shape reporting the legacy cloud source is rejected", () => {
    const todosSpec = getFlipApp("todos");
    const out = `FLIP_STATUS_BEGIN{"mode":"http","remote_enabled":true,"remote_authority":{"selected":true,"ok":true,"transport":"http","api_url_source":"/home/u/.hasna/cloud/todos.env","api_key_source":"/home/u/.hasna/cloud/todos.env","v1_base_url":"https://todos.example.invalid/v1","issues":[]}}FLIP_STATUS_END FLIP_SHA256=${sha("7")}`;
    const r = verifyFlipProvenance(out, todosSpec, "api");
    expect(r.provenanceOk).toBe(false);
    expect(r.reason).toContain(".hasna/cloud");
  });

  test("revert (local) mode passes provenance trivially — there is no connection source to prove", () => {
    const out = `{"mode":"local","api_enabled":false}`;
    const r = verifyFlipProvenance(out, spec, "local");
    expect(r.provenanceOk).toBe(true);
  });

  test("extractFlipSha256 reads the marker the script emits, and nothing when absent", () => {
    expect(extractFlipSha256(`FLIP_SHA256=${sha("e")}`)).toBe(sha("e"));
    expect(extractFlipSha256("no marker")).toBeNull();
  });

  test("extractFlipUnitEnvFiles parses the probe the script emits, and nothing when absent", () => {
    expect(
      extractFlipUnitEnvFiles("FLIP_UNIT_ENVFILES_FOUND=1\nFLIP_UNIT_ENVFILES=/a/fleet-env/knowledge.env,/b/fleet-env/knowledge.env"),
    ).toEqual(["/a/fleet-env/knowledge.env", "/b/fleet-env/knowledge.env"]);
    expect(extractFlipUnitEnvFiles("FLIP_UNIT_ENVFILES_FOUND=0")).toEqual([]);
    expect(extractFlipUnitEnvFiles("no probe")).toEqual([]);
  });

  test("the generated api script emits FLIP_SHA256 and the unit EnvironmentFiles probe", () => {
    const script = buildFlipScript(spec, "api", { envDir: "/x/fleet-env", skipRestart: true });
    expect(script).toContain('S="$(sha256sum "$ENV_FILE")"; echo "FLIP_SHA256=${S%% *}"');
    expect(script).toContain("FLIP_UNIT_ENVFILES_FOUND=");
    expect(script).toContain("systemctl show");
  });

  test("a dry-run flip returns ledger rows (source + provenance) but does not write them", () => {
    let wrote = 0;
    const runner: RunnerFn = () => {
      wrote += 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const report = runFlip({
      spec,
      mode: "api",
      waves: planWaves(selectTargets(manifest)),
      runner,
      execute: false,
      ledger: () => {
        wrote += 1;
      },
    });
    // Dry-run executes nothing and the ledger sink is never called.
    expect(wrote).toBe(0);
    expect(report.ledger.length).toBe(4);
    expect(report.ledger[0]).toMatchObject({
      app: "knowledge",
      result: "dry-run",
      provenanceOk: false,
      envSha256: null,
    });
    expect(report.ledger[0]!.sourceOfValue).toContain("fleet-env/knowledge.env");
  });

  test("an execute flip records ledger rows with the env-file sha256 and provenance verdict", () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "machines-ledger-")), "flip-ledger.jsonl");
    const runner: RunnerFn = () => ({
      stdout: `{"mode":"http","api_enabled":true,"apiKeyTier":"disk","apiKeySource":"${fleetEnv}","apiUrlSource":"${fleetEnv}"} FLIP_SHA256=${sha("b")}`,
      stderr: "",
      exitCode: 0,
    });
    const report = runFlip({
      spec,
      mode: "api",
      waves: planWaves(selectTargets(manifest)),
      runner,
      execute: true,
      ledgerPreflight: () => writeFileSync(ledgerPath, ""),
      ledger: (entries) => appendFileSync(ledgerPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n"),
    });
    expect(report.aborted).toBe(false);
    expect(report.ledger).toHaveLength(4);
    expect(report.ledger[0]).toMatchObject({ result: "ok", provenanceOk: true, envSha256: sha("b") });
    const rows = readFileSync(ledgerPath, "utf8").trim().split("\n");
    expect(rows).toHaveLength(4);
    // Ledger rows are value-free: no credential material, ever.
    expect(rows.join("\n")).not.toContain("API_KEY=");
    rmSync(dirname(ledgerPath), { recursive: true, force: true });
  });

  test("a revert (local) execute writes one ledger row per attempted target (P1 remediation)", () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "machines-ledger-")), "flip-ledger.jsonl");
    const runner: RunnerFn = () => ({ stdout: `{"mode":"local","api_enabled":false}`, stderr: "", exitCode: 0 });
    const report = runFlip({
      spec,
      mode: "local",
      waves: planWaves(selectTargets(manifest)),
      runner,
      execute: true,
      ledgerPreflight: () => writeFileSync(ledgerPath, ""),
      ledger: (entries) => appendFileSync(ledgerPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n"),
    });
    expect(report.aborted).toBe(false);
    const rows = readFileSync(ledgerPath, "utf8").trim().split("\n");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const parsed = JSON.parse(row) as { result: string; mode: string };
      expect(parsed.mode).toBe("local");
      expect(parsed.result).toBe("ok");
    }
    rmSync(dirname(ledgerPath), { recursive: true, force: true });
  });

  test("a throwing ledger preflight aborts BEFORE any remote mutation (P1 remediation)", () => {
    let runnerCalls = 0;
    const runner: RunnerFn = () => {
      runnerCalls += 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    expect(() =>
      runFlip({
        spec,
        mode: "api",
        waves: planWaves(selectTargets(manifest)),
        runner,
        execute: true,
        ledgerPreflight: () => {
          throw new Error("ENOSPC: ledger not writable");
        },
        ledger: () => {},
      }),
    ).toThrow(/ledger not writable/);
    // The preflight throws before the first wave: zero remote calls.
    expect(runnerCalls).toBe(0);
  });
});
