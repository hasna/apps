import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * MON-V2-05 gate: CLI acceptance fixture.
 *
 * Proves, through the real CLI (bins/monitor.ts) against a fresh temp store:
 *   define, validate, describe, start, stop, restart, status, logs, runs,
 *   receipts, idempotent repeated start/stop, finite drain timeout, and
 *   execution_proven:false on control acknowledgments.
 */

const APP_ROOT = join(import.meta.dir, "..", "..");
const BIN = join(APP_ROOT, "bins", "monitor.ts");

let dir: string;
let defPath: string;
let invalidNamePath: string;
let invalidShellPath: string;
let invalidCronPath: string;
let invalidTzPath: string;
let validCronPath: string;
let envShellBypassPath: string;
let envBenignPath: string;

type CliResult = {
  rc: number;
  raw: string;
  json: unknown;
};

function run(args: string[], opts: { timeoutMs?: number } = {}): CliResult {
  const started = Date.now();
  const child = spawnSync(process.execPath, ["run", BIN, ...args], {
    cwd: APP_ROOT,
    env: { ...process.env, MONITOR_CONFIG_DIR: dir },
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 60_000,
  });
  const raw = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  let json: unknown = null;
  const out = child.stdout ?? "";
  if (out.trim().length > 0) {
    try {
      json = JSON.parse(out);
    } catch {
      json = out;
    }
  }
  return { rc: child.status ?? -1, raw, json };
}

function asObj(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`expected JSON object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function makeDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: "heartbeat-check",
    description: "monitor-v2 fixture slug",
    tags: ["fixture"],
    cadence: { type: "interval", seconds: 60 },
    execution: {
      timeoutSeconds: 30,
      maxConcurrency: 1,
      overlap: "skip",
      maxAttempts: 2,
      retryBackoffSeconds: [5],
      retryOn: ["failed"],
    },
    checks: [
      {
        id: "c1",
        command: { executable: "/bin/true", args: [], timeoutSeconds: 10 },
      },
    ],
    ...overrides,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "monitor-v2-cli-"));
  defPath = join(dir, "heartbeat-check.json");
  writeFileSync(defPath, JSON.stringify(makeDefinition(), null, 2));

  invalidNamePath = join(dir, "invalid-name.json");
  writeFileSync(
    invalidNamePath,
    JSON.stringify(makeDefinition({ name: "Bad Name" }), null, 2)
  );

  invalidShellPath = join(dir, "invalid-shell.json");
  writeFileSync(
    invalidShellPath,
    JSON.stringify(
      makeDefinition({
        checks: [
          {
            id: "c1",
            command: { executable: "sh", args: ["-c", "echo hi"], timeoutSeconds: 10 },
          },
        ],
      }),
      null,
      2
    )
  );

  invalidCronPath = join(dir, "invalid-cron.json");
  writeFileSync(
    invalidCronPath,
    JSON.stringify(
      makeDefinition({
        cadence: { type: "cron", expression: "not a cron", timezone: "UTC" },
      }),
      null,
      2
    )
  );

  invalidTzPath = join(dir, "invalid-tz.json");
  writeFileSync(
    invalidTzPath,
    JSON.stringify(
      makeDefinition({
        cadence: { type: "cron", expression: "*/5 * * * *", timezone: "Not/AZone" },
      }),
      null,
      2
    )
  );

  validCronPath = join(dir, "valid-cron.json");
  writeFileSync(
    validCronPath,
    JSON.stringify(
      makeDefinition({
        cadence: { type: "cron", expression: "*/5 * * * *", timezone: "UTC" },
      }),
      null,
      2
    )
  );

  envShellBypassPath = join(dir, "env-shell-bypass.json");
  writeFileSync(
    envShellBypassPath,
    JSON.stringify(
      makeDefinition({
        checks: [
          {
            id: "c1",
            command: {
              executable: "env",
              args: ["bash", "-c", "echo hi"],
              timeoutSeconds: 10,
            },
          },
        ],
      }),
      null,
      2
    )
  );

  envBenignPath = join(dir, "env-benign.json");
  writeFileSync(
    envBenignPath,
    JSON.stringify(
      makeDefinition({
        checks: [
          {
            id: "c1",
            command: {
              executable: "env",
              args: ["FOO=1", "/bin/true"],
              timeoutSeconds: 10,
            },
          },
        ],
      }),
      null,
      2
    )
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("monitor slug lifecycle CLI acceptance fixture", () => {
  it("validate accepts a well-formed definition", () => {
    const r = run(["slug", "validate", defPath, "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.valid).toBe(true);
  });

  it("validate rejects an invalid slug name", () => {
    const r = run(["slug", "validate", invalidNamePath, "--json"]);
    expect(r.rc).toBe(1);
    const j = asObj(r.json);
    expect(j.valid).toBe(false);
    expect(JSON.stringify(j.errors ?? [])).toContain("name");
  });

  it("validate rejects shell-shaped commands", () => {
    const r = run(["slug", "validate", invalidShellPath, "--json"]);
    expect(r.rc).toBe(1);
    const j = asObj(r.json);
    expect(j.valid).toBe(false);
    expect(JSON.stringify(j.errors ?? [])).toMatch(/shell/i);
  });

  it("validate rejects an invalid cron expression", () => {
    const r = run(["slug", "validate", invalidCronPath, "--json"]);
    expect(r.rc).toBe(1);
    const j = asObj(r.json);
    expect(j.valid).toBe(false);
    expect(JSON.stringify(j.errors ?? [])).toMatch(/cron/i);
  });

  it("validate rejects an invalid cron timezone", () => {
    const r = run(["slug", "validate", invalidTzPath, "--json"]);
    expect(r.rc).toBe(1);
    const j = asObj(r.json);
    expect(j.valid).toBe(false);
    expect(JSON.stringify(j.errors ?? [])).toMatch(/cron|timezone/i);
  });

  it("validate accepts a valid cron cadence", () => {
    const r = run(["slug", "validate", validCronPath, "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.valid).toBe(true);
  });

  it("validate rejects shell invocation through the env wrapper", () => {
    const r = run(["slug", "validate", envShellBypassPath, "--json"]);
    expect(r.rc).toBe(1);
    const j = asObj(r.json);
    expect(j.valid).toBe(false);
    expect(JSON.stringify(j.errors ?? [])).toMatch(/shell/i);
  });

  it("validate accepts env with assignments and a non-shell command", () => {
    const r = run(["slug", "validate", envBenignPath, "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.valid).toBe(true);
  });

  it("define creates the slug at revision 1", () => {
    const r = run(["slug", "define", "heartbeat-check", "--file", defPath, "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.accepted).toBe(true);
    expect(j.revision).toBe(1);
    expect(j.slug).toBe("heartbeat-check");
  });

  it("define is idempotent: same definition does not create a new revision", () => {
    const r = run(["slug", "define", "heartbeat-check", "--file", defPath, "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.accepted).toBe(true);
    expect(j.revision).toBe(1);
    expect(j.changed).toBe(false);
  });

  it("describe reports revision, cadence and desired state", () => {
    const r = run(["slug", "describe", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.slug).toBe("heartbeat-check");
    expect(j.revision).toBe(1);
    expect(j.desired_state).toBe("stopped");
    expect(asObj(j.cadence as Record<string, unknown>).type).toBe("interval");
  });

  it("start returns a control acknowledgment with execution_proven:false", () => {
    const r = run(["start", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.accepted).toBe(true);
    expect(j.state).toBe("running");
    expect(j.execution_proven).toBe(false);
    expect(j.run_id).toBeNull();
  });

  it("repeated start is idempotent and does not duplicate", () => {
    const r = run(["start", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.accepted).toBe(true);
    expect(j.code).toBe("already_running");
    expect(j.execution_proven).toBe(false);
  });

  it("repeating an idempotency key returns the original control result", () => {
    const key = "fixture-key-1";
    const first = run(["start", "heartbeat-check", "--idempotency-key", key, "--json"]);
    expect(first.rc).toBe(0);
    const replay = run(["start", "heartbeat-check", "--idempotency-key", key, "--json"]);
    expect(replay.rc).toBe(0);
    const a = asObj(first.json);
    const b = asObj(replay.json);
    expect(b.accepted).toBe(true);
    expect(b.code).toBe("idempotent_replay");
    expect(b.state).toBe(a.state);
    expect(b.revision).toBe(a.revision);
  });

  it("status reports control and execution separately", () => {
    const r = run(["status", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.slug).toBe("heartbeat-check");
    expect(j.desired_state).toBe("running");
    expect(j.execution_proven).toBe(false);
    expect(j.queue_depth).toBe(0);
  });

  it("stop returns draining with execution_proven:false", () => {
    const r = run(["stop", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.accepted).toBe(true);
    expect(j.state).toBe("draining");
    expect(j.execution_proven).toBe(false);
  });

  it("stop on a draining slug is idempotent", () => {
    const r = run(["stop", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.code).toBe("already_stopped");
  });

  it("stop --wait honors a finite drain timeout and returns drain_pending", () => {
    // Ensure a run is queued so the drain cannot complete without an execution plane.
    const admit = run(["start", "heartbeat-check", "--next-cadence", "--json"]);
    expect(admit.rc).toBe(0);

    const started = Date.now();
    const r = run(["stop", "heartbeat-check", "--wait", "--timeout", "1s", "--json"]);
    const elapsedMs = Date.now() - started;
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.code).toBe("drain_pending");
    expect(j.execution_proven).toBe(false);
    expect(j.pending_runs).toBe(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(900);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("restart resumes the same slug into running", () => {
    const r = run(["restart", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(j.accepted).toBe(true);
    expect(j.state).toBe("running");
    expect(j.execution_proven).toBe(false);
  });

  it("start --next-cadence admits a run visible via runs", () => {
    const r = run(["start", "heartbeat-check", "--next-cadence", "--json"]);
    expect(r.rc).toBe(0);
    expect(asObj(r.json).accepted).toBe(true);

    const runs = run(["runs", "heartbeat-check", "--json"]);
    expect(runs.rc).toBe(0);
    const j = asObj(runs.json);
    const rows = j.entries as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(asObj(rows[0] as Record<string, unknown>).state).toBe("admitted");
  });

  it("logs returns a bounded, parseable result", () => {
    const r = run(["logs", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(Array.isArray(j.entries)).toBe(true);
  });

  it("receipts is empty while nothing has executed", () => {
    const r = run(["receipts", "heartbeat-check", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    expect(Array.isArray(j.entries)).toBe(true);
    expect((j.entries as unknown[]).length).toBe(0);
  });

  it("slug list contains the defined slug", () => {
    const r = run(["slug", "list", "--json"]);
    expect(r.rc).toBe(0);
    const j = asObj(r.json);
    const rows = j.entries as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((row) => asObj(row as Record<string, unknown>).name === "heartbeat-check")).toBe(true);
  });
});
