import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../store.js";

const pkgDir = join(import.meta.dir, "..", "..");
const pkgVersion = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version as string;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "workflows-cli-"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function runCli(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "src/cli/index.ts", ...args], {
    cwd: pkgDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HASNA_WORKFLOWS_DATA_DIR: dataDir, ...env },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function writeGraph(name: string, body: unknown): string {
  const path = join(dataDir, name);
  writeFileSync(path, JSON.stringify(body, null, 2), "utf8");
  return path;
}

const linearGraph = {
  name: "cli-demo",
  version: "1.0.0",
  nodes: [
    { id: "start", type: "start", next: "work" },
    { id: "work", type: "step", command: "printf done-work", next: "done" },
    { id: "done", type: "end" },
  ],
};

const failingGraph = {
  name: "cli-fail",
  version: "1.0.0",
  nodes: [
    { id: "start", type: "start", next: "work" },
    { id: "work", type: "step", command: "exit 7", next: "done" },
    { id: "done", type: "end" },
  ],
};

const whileGraph = {
  name: "cli-while",
  version: "1.0.0",
  nodes: [
    { id: "start", type: "start", next: "w" },
    { id: "w", type: "while", condition: "i < 2", body: ["tick"], maxIterations: 5, next: "done" },
    { id: "tick", type: "step", command: "printf tick" },
    { id: "done", type: "end" },
  ],
};

describe("workflows CLI (slice 1 scaffold)", () => {
  test("--version answers before anything else and exits 0", async () => {
    const r = await runCli(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(pkgVersion);
  });

  test("--help prints usage and exits 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage");
    expect(r.stdout).toContain("workflows");
  });

  test("`version` command prints the package version", async () => {
    const r = await runCli(["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(pkgVersion);
  });

  test("`health --json` prints a health report", async () => {
    const r = await runCli(["health", "--json"]);
    expect(r.exitCode).toBe(0);
    const h = JSON.parse(r.stdout) as { ok: boolean; service: string; version: string };
    expect(h.ok).toBe(true);
    expect(h.service).toBe("workflows");
    expect(h.version).toBe(pkgVersion);
  });

  test("`info` prints configuration without any credential value", async () => {
    const r = await runCli(["info"]);
    expect(r.exitCode).toBe(0);
    const info = JSON.parse(r.stdout) as { name: string; version: string; apiKey: unknown };
    expect(info.name).toBe("workflows");
    expect(info.version).toBe(pkgVersion);
    expect("apiKey" in info).toBe(false);
  });

  test("an unknown command exits non-zero", async () => {
    const r = await runCli(["definitely-not-a-command"]);
    expect(r.exitCode).not.toBe(0);
  });
});

describe("workflows CLI — the fourteen commands", () => {
  test("init scaffolds a sample graph that validate accepts", async () => {
    const target = join(dataDir, "sample.json");
    const init = await runCli(["init", target]);
    expect(init.exitCode).toBe(0);
    const valid = await runCli(["validate", target, "--json"]);
    expect(valid.exitCode).toBe(0);
    const report = JSON.parse(valid.stdout) as { ok: boolean };
    expect(report.ok).toBe(true);
  });

  test("init refuses to overwrite", async () => {
    const target = join(dataDir, "sample.json");
    const r = await runCli(["init", target]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("refusing to overwrite");
  });

  test("validate rejects a malformed graph with a non-zero exit", async () => {
    const bad = writeGraph("bad.json", { name: "bad", version: "1.0.0", nodes: [{ id: "solo", type: "step", prompt: "x" }] });
    const r = await runCli(["validate", bad]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("start");
  });

  test("run executes a command-step graph to completion", async () => {
    const file = writeGraph("linear.json", linearGraph);
    const r = await runCli(["run", file, "--json"]);
    expect(r.exitCode).toBe(0);
    const summary = JSON.parse(r.stdout) as { status: string; runId: string };
    expect(summary.status).toBe("completed");
    const show = await runCli(["runs", "show", summary.runId, "--json"]);
    expect(show.exitCode).toBe(0);
    const run = JSON.parse(show.stdout) as { graphName: string };
    expect(run.graphName).toBe("cli-demo");
  });

  test("run fails the run when a command step fails and exits non-zero", async () => {
    const file = writeGraph("fail.json", failingGraph);
    const r = await runCli(["run", file, "--json"]);
    expect(r.exitCode).toBe(1);
    const summary = JSON.parse(r.stdout) as { status: string; error: string };
    expect(summary.status).toBe("failed");
    expect(summary.error).toContain("exit 7");
  });

  test("run executes a while loop with the declared bound", async () => {
    const file = writeGraph("while.json", whileGraph);
    const r = await runCli(["run", file, "--json"]);
    expect(r.exitCode).toBe(0);
    const summary = JSON.parse(r.stdout) as { result: { iterations: Record<string, number> } };
    expect(summary.result.iterations.w).toBe(2);
  });

  test("runs list filters by status; cancel and resume round-trip", async () => {
    const slow = {
      name: "cli-slow",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "sleep" },
        { id: "sleep", type: "step", command: "sleep 3", next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const file = writeGraph("slow.json", slow);
    // start the run in the background so it is mid-flight (running) when cancelled
    const runProc = Bun.spawn(["bun", "src/cli/index.ts", "run", file, "--json"], {
      cwd: pkgDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HASNA_WORKFLOWS_DATA_DIR: dataDir },
    });
    await Bun.sleep(400);
    const running = await runCli(["runs", "list", "--status", "running", "--json"]);
    const runs = JSON.parse(running.stdout) as { id: string }[];
    expect(runs.length).toBeGreaterThan(0);
    const runId = runs[0].id;

    const cancel = await runCli(["runs", "cancel", runId]);
    expect(cancel.exitCode).toBe(0);
    const cancelled = await runCli(["runs", "show", runId, "--json"]);
    expect((JSON.parse(cancelled.stdout) as { status: string }).status).toBe("cancelled");
    await runProc.exited;

    const resume = await runCli(["runs", "resume", runId]);
    expect(resume.exitCode).toBe(0);
    const resumed = await runCli(["runs", "show", runId, "--json"]);
    expect((JSON.parse(resumed.stdout) as { status: string }).status).toBe("pending");
  });

  test("nodes list shows the executed node rows", async () => {
    const file = writeGraph("linear3.json", linearGraph);
    const run = await runCli(["run", file, "--json"]);
    const { runId } = JSON.parse(run.stdout) as { runId: string };
    const nodes = await runCli(["nodes", runId, "--json"]);
    expect(nodes.exitCode).toBe(0);
    const rows = JSON.parse(nodes.stdout) as { nodeId: string; status: string }[];
    expect(rows.map((n) => n.nodeId)).toContain("work");
    expect(rows.find((n) => n.nodeId === "work")?.status).toBe("completed");
  });

  test("daemon start --once reaps and writes a status record; daemon status reads it", async () => {
    const once = await runCli(["daemon", "start", "--once", "--json"]);
    expect(once.exitCode).toBe(0);
    const report = JSON.parse(once.stdout) as { dispatched: number; advanced: number };
    expect(typeof report.dispatched).toBe("number");
    const status = await runCli(["daemon", "status", "--json"]);
    expect(status.exitCode).toBe(0);
    const record = JSON.parse(status.stdout) as { lastReap: { dispatched: number } };
    expect(typeof record.lastReap.dispatched).toBe("number");
  });

  test("memos list and clear work after a memoized run", async () => {
    const memoGraph = {
      name: "cli-memo",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "calc" },
        { id: "calc", type: "step", command: "printf 42", memo: true, next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const file = writeGraph("memo.json", memoGraph);
    const first = await runCli(["run", file, "--json"]);
    expect(first.exitCode).toBe(0);
    const list = await runCli(["memos", "list", "--json"]);
    const memos = JSON.parse(list.stdout) as { key: string }[];
    expect(memos.some((m) => m.key.startsWith("cli-memo:calc:"))).toBe(true);

    const noYes = await runCli(["memos", "clear"]);
    expect(noYes.exitCode).toBe(1);
    const clear = await runCli(["memos", "clear", "--yes"]);
    expect(clear.exitCode).toBe(0);
    const after = await runCli(["memos", "list", "--json"]);
    expect((JSON.parse(after.stdout) as unknown[]).length).toBe(0);
  });

  test("lanes list shows exactly the four lanes", async () => {
    const r = await runCli(["lanes", "list", "--json"]);
    expect(r.exitCode).toBe(0);
    const lanes = JSON.parse(r.stdout) as { kind: string }[];
    expect(lanes.map((l) => l.kind).sort()).toEqual(["claude", "codex", "cursor", "grok"]);
  });

  test("repair reports torn-run counts without error", async () => {
    const r = await runCli(["repair", "--json"]);
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.stdout) as { interrupted: number; requeued: number; failed: number };
    expect(typeof report.interrupted).toBe("number");
  });
});

describe("workflows CLI — slice 4 verbs (live-verify closures)", () => {
  test("init creates the store layout (workflows/, sessions/, workflows.db) and the default sample inside workflows/", async () => {
    const r = await runCli(["init"]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(dataDir, "workflows"))).toBe(true);
    expect(existsSync(join(dataDir, "sessions"))).toBe(true);
    expect(existsSync(join(dataDir, "workflows.db"))).toBe(true);
    const samplePath = join(dataDir, "workflows", "demo.json");
    expect(existsSync(samplePath)).toBe(true);
    const valid = await runCli(["validate", samplePath, "--json"]);
    expect(valid.exitCode).toBe(0);
    expect((JSON.parse(valid.stdout) as { ok: boolean }).ok).toBe(true);
  });

  test("run --input k=v feeds the decision scope", async () => {
    const inputGraph = {
      name: "cli-input",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "decide" },
        { id: "decide", type: "decision", condition: "go == 'yes'", then: "yes", else: "no" },
        { id: "yes", type: "step", command: "printf yes-branch", next: "done" },
        { id: "no", type: "step", command: "printf no-branch", next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const file = writeGraph("input.json", inputGraph);
    const yes = await runCli(["run", file, "--input", "go=yes", "--json"]);
    expect(yes.exitCode).toBe(0);
    const yesSummary = JSON.parse(yes.stdout) as { result: { steps: Record<string, { output: string }> } };
    expect(yesSummary.result.steps.yes.output).toContain("yes-branch");
    const no = await runCli(["run", file, "--input", "go=no", "--json"]);
    expect(no.exitCode).toBe(0);
    const noSummary = JSON.parse(no.stdout) as { result: { steps: Record<string, { output: string }> } };
    expect(noSummary.result.steps.no.output).toContain("no-branch");
  });

  test("run --idempotency-key reuses the same run on a repeat", async () => {
    const file = writeGraph("linear-idem.json", linearGraph);
    const first = await runCli(["run", file, "--idempotency-key", "idem-1", "--json"]);
    expect(first.exitCode).toBe(0);
    const firstSummary = JSON.parse(first.stdout) as { runId: string; status: string };
    expect(firstSummary.status).toBe("completed");
    const second = await runCli(["run", file, "--idempotency-key", "idem-1", "--json"]);
    expect(second.exitCode).toBe(0);
    const secondSummary = JSON.parse(second.stdout) as { runId: string; reused: boolean };
    expect(secondSummary.runId).toBe(firstSummary.runId);
    expect(secondSummary.reused).toBe(true);
  });

  test("run --idempotency-key completes a while-node graph (regression: partial __wf crashed advanceRun)", async () => {
    // Live-verify failure 2026-08-25: `run --idempotency-key` on any graph
    // containing a while node crashed with "undefined is not an object
    // (evaluating 'wf.loops[node.id]')" rc=1 and left the run orphaned in
    // 'running'. withIdempotencyKey minted `__wf: { idempotencyKey }` without
    // the loops/completedLoops members and advanceRun's default-shape
    // fallback only applied when __wf was wholly absent.
    const file = writeGraph("while-idem.json", whileGraph);
    const first = await runCli(["run", file, "--idempotency-key", "idem-while-1", "--json"]);
    expect(first.exitCode).toBe(0);
    const firstSummary = JSON.parse(first.stdout) as { status: string; runId: string; result: { iterations: Record<string, number> } };
    expect(firstSummary.status).toBe("completed");
    expect(firstSummary.result.iterations.w).toBe(2);
    const second = await runCli(["run", file, "--idempotency-key", "idem-while-1", "--json"]);
    expect(second.exitCode).toBe(0);
    const secondSummary = JSON.parse(second.stdout) as { runId: string; reused: boolean };
    expect(secondSummary.runId).toBe(firstSummary.runId);
    expect(secondSummary.reused).toBe(true);
  });

  test("runs events <id> emits the run's WAL event stream", async () => {
    const file = writeGraph("linear-events.json", linearGraph);
    const run = await runCli(["run", file, "--json"]);
    const { runId } = JSON.parse(run.stdout) as { runId: string };
    const events = await runCli(["runs", "events", runId, "--json"]);
    expect(events.exitCode).toBe(0);
    const rows = JSON.parse(events.stdout) as { op: { op: string } }[];
    const ops = rows.map((r) => r.op.op);
    expect(ops).toContain("run_started");
    expect(ops).toContain("run_finished");
    expect(ops).toContain("node_finished");
  });

  test("nodes show <run> <node> prints the single node row", async () => {
    const file = writeGraph("linear-nodeshow.json", linearGraph);
    const run = await runCli(["run", file, "--json"]);
    const { runId } = JSON.parse(run.stdout) as { runId: string };
    const show = await runCli(["nodes", "show", runId, "work", "--json"]);
    expect(show.exitCode).toBe(0);
    const row = JSON.parse(show.stdout) as { nodeId: string; status: string };
    expect(row.nodeId).toBe("work");
    expect(row.status).toBe("completed");
    // the bare form still lists
    const bare = await runCli(["nodes", runId, "--json"]);
    expect(bare.exitCode).toBe(0);
    expect((JSON.parse(bare.stdout) as unknown[]).length).toBeGreaterThan(0);
  });

  test("sessions list and pull work after a run", async () => {
    const file = writeGraph("linear-sessions.json", linearGraph);
    const run = await runCli(["run", file, "--json"]);
    expect(run.exitCode).toBe(0);
    const list = await runCli(["sessions", "list", "--json"]);
    expect(list.exitCode).toBe(0);
    expect((JSON.parse(list.stdout) as unknown[]).length).toBeGreaterThan(0);
    const pull = await runCli(["sessions", "pull", "--json"]);
    expect(pull.exitCode).toBe(0);
    const report = JSON.parse(pull.stdout) as { entries: number; torn: boolean; liveClaims: unknown[] };
    expect(report.entries).toBeGreaterThan(0);
    expect(typeof report.torn).toBe("boolean");
    expect(Array.isArray(report.liveClaims)).toBe(true);
  });

  test("machines list and status work", async () => {
    const list = await runCli(["machines", "list", "--json"]);
    expect(list.exitCode).toBe(0);
    const rows = JSON.parse(list.stdout) as { local: boolean; name: string }[];
    expect(rows.some((r) => r.local)).toBe(true);
    const status = await runCli(["machines", "status", "--json"]);
    expect(status.exitCode).toBe(0);
    const report = JSON.parse(status.stdout) as { hostname: string; dataDir: string; layout: { workflows: boolean; sessions: boolean; db: boolean } };
    expect(typeof report.hostname).toBe("string");
    expect(report.dataDir).toBe(dataDir);
    expect(report.layout.workflows).toBe(true);
    expect(report.layout.sessions).toBe(true);
    expect(report.layout.db).toBe(true);
  });

  test("graph <file> renders text, dot, and json", async () => {
    const file = writeGraph("render.json", whileGraph);
    const text = await runCli(["graph", file]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("while i < 2");
    const dot = await runCli(["graph", file, "--format", "dot"]);
    expect(dot.exitCode).toBe(0);
    expect(dot.stdout).toContain("digraph");
    const json = await runCli(["graph", file, "--format", "json"]);
    expect(json.exitCode).toBe(0);
    const rendered = JSON.parse(json.stdout) as { name: string; edges: unknown[] };
    expect(rendered.name).toBe("cli-while");
    expect(rendered.edges.length).toBeGreaterThan(0);
  });

  test("lanes probe <lane> reports the wired-vs-not-ready shape", async () => {
    const probe = await runCli(["lanes", "probe", "claude", "--json"]);
    expect(probe.exitCode).toBe(0);
    const report = JSON.parse(probe.stdout) as { kind: string; wired: boolean };
    expect(report.kind).toBe("claude");
    expect(typeof report.wired).toBe("boolean");
    const list = await runCli(["lanes", "list", "--json"]);
    expect(list.exitCode).toBe(0);
    const lanes = JSON.parse(list.stdout) as { kind: string; wired: boolean }[];
    expect(lanes.map((l) => l.kind).sort()).toEqual(["claude", "codex", "cursor", "grok"]);
    for (const lane of lanes) expect(typeof lane.wired).toBe("boolean");
  });

  test("top-level resume restores an interrupted run, reusing memoized node outputs", async () => {
    const store = openStore(dataDir);
    try {
      const run = store.createRun({ graphName: "cli-interrupted", graphVersion: "1.0.0", context: { n: 1 } });
      const node = store.createRunNode({ runId: run.id, nodeId: "work" });
      store.setRunNodeStatus(node.id, "completed", { output: { ok: true, exitCode: 0, output: "done-work", durationMs: 1 } });
      store.setRunStatus(run.id, "interrupted", { error: "worker died mid-flight" });
      const r = await runCli(["resume", run.id, "--json"]);
      expect(r.exitCode).toBe(0);
      const restored = JSON.parse(r.stdout) as { runId: string; status: string; nodesRestored: number; memoizedNodes: number };
      expect(restored.runId).toBe(run.id);
      expect(restored.status).toBe("pending");
      expect(restored.memoizedNodes).toBe(1);
      const show = await runCli(["runs", "show", run.id, "--json"]);
      expect((JSON.parse(show.stdout) as { status: string }).status).toBe("pending");
    } finally {
      store.close();
    }
  });

  test("repair then top-level resume restores a torn run (live-verify closure)", async () => {
    // Live-verify 2026-08-25: `workflows repair` requeued a torn run to
    // `pending`, so top-level `workflows resume <run-id>` hit
    // restoreInterruptedRun's guard and always rejected. Repair now marks the
    // run `interrupted`, so resume restores it with memoized node outputs.
    const store = openStore(dataDir);
    try {
      const run = store.createRun({ graphName: "cli-torn-resume", graphVersion: "1.0.0", context: { n: 1 } });
      const node = store.createRunNode({ runId: run.id, nodeId: "work" });
      store.setRunNodeStatus(node.id, "completed", { output: { ok: true, exitCode: 0, output: "done-work", durationMs: 1 } });
      store.setRunStatus(run.id, "running");

      const repair = await runCli(["repair", "--json"]);
      expect(repair.exitCode).toBe(0);
      expect((JSON.parse(repair.stdout) as { interrupted: number; requeued: number }).requeued).toBe(1);

      const r = await runCli(["resume", run.id, "--json"]);
      expect(r.exitCode).toBe(0);
      const restored = JSON.parse(r.stdout) as { runId: string; status: string; memoizedNodes: number };
      expect(restored.runId).toBe(run.id);
      expect(restored.status).toBe("pending");
      expect(restored.memoizedNodes).toBe(1);
      const show = await runCli(["runs", "show", run.id, "--json"]);
      expect((JSON.parse(show.stdout) as { status: string }).status).toBe("pending");
    } finally {
      store.close();
    }
  });

  test("resume on a non-interrupted run names the distinction", async () => {
    const store = openStore(dataDir);
    try {
      const run = store.createRun({ graphName: "cli-not-interrupted", graphVersion: "1.0.0" });
      store.setRunStatus(run.id, "failed", { error: "boom" });
      const r = await runCli(["resume", run.id]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("runs resume");
    } finally {
      store.close();
    }
  });

  test("three concurrent CLI runs on one store all complete without SQLITE_BUSY (stress V1 F1)", async () => {
    const file = writeGraph("concurrent.json", {
      name: "cli-concurrent",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "work" },
        { id: "work", type: "step", command: "sleep 0.35; printf concurrent-ok", next: "done" },
        { id: "done", type: "end" },
      ],
    });
    // Measured 2026-08-30: 3 simultaneous processes on one data dir — 2/3
    // died rc=1 with stderr exactly "database is locked". All must now
    // complete (busy-wait + bounded retry in the store path).
    const procs = Array.from({ length: 3 }, () =>
      Bun.spawn(["bun", "src/cli/index.ts", "run", file, "--json"], {
        cwd: pkgDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HASNA_WORKFLOWS_DATA_DIR: dataDir },
      }),
    );
    const results = await Promise.all(
      procs.map(async (p) => {
        const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
        return { stdout, stderr, exitCode: await p.exited };
      }),
    );
    for (const r of results) {
      expect(r.exitCode).toBe(0);
      expect(r.stderr).not.toContain("database is locked");
      expect((JSON.parse(r.stdout) as { status: string }).status).toBe("completed");
    }
  });

  test("nodes list shows one row per while iteration; nodes show reflects the latest (stress V4 P3)", async () => {
    const file = writeGraph("while-rows.json", whileGraph); // body ["tick"], i < 2
    const run = await runCli(["run", file, "--json"]);
    expect(run.exitCode).toBe(0);
    const { runId } = JSON.parse(run.stdout) as { runId: string };
    const list = await runCli(["nodes", runId, "--json"]);
    expect(list.exitCode).toBe(0);
    const rows = JSON.parse(list.stdout) as { id: string; nodeId: string; status: string }[];
    const tickRows = rows.filter((n) => n.nodeId === "tick");
    expect(tickRows).toHaveLength(2); // pre-fix: 1 (iteration 1 only)
    for (const row of tickRows) expect(row.status).toBe("completed");
    const show = await runCli(["nodes", "show", runId, "tick", "--json"]);
    expect(show.exitCode).toBe(0);
    const one = JSON.parse(show.stdout) as { id: string };
    expect(one.id).toBe(tickRows[1].id); // the latest iteration's row
  });
});
