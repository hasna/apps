import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
