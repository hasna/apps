#!/usr/bin/env bun
/**
 * workflows — the CLI surface of @hasna/workflows.
 *
 * Answers --version/--help before anything else and binds nothing. Fourteen
 * commands: init, validate, run, runs list, runs show, runs cancel, runs
 * resume, nodes list, daemon start, daemon status, daemon stop, memos list,
 * memos clear, lanes list — plus the shell commands version/health/info.
 */
import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createWorkflowsService, packageVersion, resolveWorkflowsConfig } from "../service.js";
import { validateGraph, type WorkflowGraph } from "../graph.js";
import { openStore } from "../store.js";
import { SessionWAL } from "../wal.js";
import { repairTornRuns, resetRunNodes } from "../session.js";
import { runGraphToCompletion, WorkflowsDaemon, type ReapReport } from "../daemon.js";
import { laneInventory } from "../lanes/index.js";

const program = new Command();

program
  .name("workflows")
  .description("Universal graph workflow app — CLI surface of @hasna/workflows")
  .version(packageVersion());

// -- shell commands ---------------------------------------------------------

program
  .command("version")
  .description("Print the installed version")
  .action(() => {
    console.log(packageVersion());
  });

program
  .command("health")
  .description("Report service health")
  .option("-j, --json", "JSON output")
  .action((opts: { json?: boolean }) => {
    const service = createWorkflowsService();
    const report = service.health();
    if (opts.json) {
      console.log(JSON.stringify(report));
    } else {
      console.log(`ok ${report.service}@${report.version} pid=${report.pid} uptimeMs=${report.uptimeMs}`);
    }
  });

program
  .command("info")
  .description("Show service configuration (never credentials)")
  .action(() => {
    const service = createWorkflowsService();
    console.log(
      JSON.stringify(
        {
          name: service.name,
          version: service.version,
          dataDir: service.config.dataDir,
          port: service.config.port,
          host: service.config.host,
          apiUrl: service.config.apiUrl ?? null,
        },
        null,
        2,
      ),
    );
  });

// -- the fourteen commands --------------------------------------------------

function loadGraph(file: string): WorkflowGraph {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`cannot read graph file ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`graph file ${file} is not valid JSON`);
  }
  return parsed as WorkflowGraph;
}

function openLocal(): { store: ReturnType<typeof openStore>; wal: SessionWAL } {
  const config = resolveWorkflowsConfig();
  mkdirSync(config.dataDir, { recursive: true });
  return { store: openStore(config.dataDir), wal: SessionWAL.open(config.dataDir) };
}

function parseContext(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("context must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`invalid --context JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

program
  .command("init")
  .description("Scaffold a sample workflow graph file")
  .argument("[file]", "output path (default workflows.json)")
  .action((file: string | undefined) => {
    const target = file ?? "workflows.json";
    if (existsSync(target)) {
      console.error(`refusing to overwrite existing file ${target}`);
      process.exit(1);
    }
    const sample: WorkflowGraph = {
      name: "demo",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "w" },
        { id: "w", type: "while", condition: "steps.check.ok != true", body: ["work", "check"], maxIterations: 5, next: "done" },
        { id: "work", type: "step", lane: "claude", prompt: "fix the failing check", maxRetries: 1 },
        { id: "check", type: "step", command: "echo check-ok" },
        { id: "done", type: "end" },
      ],
    };
    writeFileSync(target, JSON.stringify(sample, null, 2) + "\n", "utf8");
    console.log(`wrote ${target}`);
  });

program
  .command("validate")
  .description("Validate a workflow graph file")
  .argument("<file>", "graph JSON file")
  .option("-j, --json", "JSON output")
  .action((file: string, opts: { json?: boolean }) => {
    const graph = loadGraph(file);
    const result = validateGraph(graph);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(`valid: ${graph.name}@${graph.version} (${graph.nodes.length} nodes)`);
    } else {
      for (const issue of result.issues) {
        console.error(`${issue.path}: ${issue.message}`);
      }
      console.error(`invalid: ${result.issues.length} issue(s)`);
    }
    if (!result.ok) process.exit(1);
  });

program
  .command("run")
  .description("Run a workflow graph to a terminal state (bounded)")
  .argument("<file>", "graph JSON file")
  .option("--context <json>", "JSON context object for the run")
  .option("--max-cycles <n>", "bound on reap cycles", "500")
  .option("-j, --json", "JSON output")
  .action(async (file: string, opts: { context?: string; maxCycles?: string; json?: boolean }) => {
    const graph = loadGraph(file);
    const validation = validateGraph(graph);
    if (!validation.ok) {
      throw new Error(`graph validation failed: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    }
    const { store, wal } = openLocal();
    try {
      const maxCycles = Number(opts.maxCycles ?? 500);
      const final = await runGraphToCompletion(store, wal, graph, parseContext(opts.context), { maxCycles });
      const summary = {
        runId: final.id,
        status: final.status,
        error: final.error ?? null,
        result: final.resultJson ? JSON.parse(final.resultJson) : null,
      };
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`run ${final.id}: ${final.status}${final.error ? ` — ${final.error}` : ""}`);
        if (final.resultJson) console.log(final.resultJson);
      }
      if (final.status !== "completed") process.exit(1);
    } finally {
      store.close();
    }
  });

program
  .command("runs")
  .description("Manage runs")
  .argument("<action>", "list | show | cancel | resume")
  .argument("[id]", "run id (show/cancel/resume)")
  .option("--status <status>", "filter by status (list)")
  .option("--limit <n>", "max rows (list)", "100")
  .option("-j, --json", "JSON output")
  .action((action: string, id: string | undefined, opts: { status?: string; limit?: string; json?: boolean }) => {
    const { store } = openLocal();
    try {
      switch (action) {
        case "list": {
          const runs = store.listRuns({ status: opts.status as never, limit: Number(opts.limit ?? 100) });
          if (opts.json) {
            console.log(JSON.stringify(runs, null, 2));
          } else {
            for (const run of runs) {
              console.log(`${run.status.padEnd(11)} ${run.id}  ${run.graphName}@${run.graphVersion}  attempts=${run.attempts}`);
            }
          }
          return;
        }
        case "show": {
          if (!id) throw new Error("runs show requires a run id");
          const run = store.getRun(id);
          if (!run) throw new Error(`no such run ${id}`);
          console.log(JSON.stringify(run, null, 2));
          return;
        }
        case "cancel": {
          if (!id) throw new Error("runs cancel requires a run id");
          const run = store.getRun(id);
          if (!run) throw new Error(`no such run ${id}`);
          if (run.status !== "pending" && run.status !== "running") {
            throw new Error(`run ${id} is ${run.status}; only pending/running runs can be cancelled`);
          }
          store.setRunStatus(id, "cancelled", { error: "cancelled by operator" });
          console.log(`cancelled ${id}`);
          return;
        }
        case "resume": {
          if (!id) throw new Error("runs resume requires a run id");
          const run = store.getRun(id);
          if (!run) throw new Error(`no such run ${id}`);
          if (run.status !== "cancelled" && run.status !== "failed") {
            throw new Error(`run ${id} is ${run.status}; only cancelled/failed runs can be resumed`);
          }
          resetRunNodes(store, run);
          store.setRunStatus(id, "pending", { error: undefined });
          console.log(`resumed ${id} to pending`);
          return;
        }
        default:
          throw new Error(`unknown runs action ${action} (expected list | show | cancel | resume)`);
      }
    } finally {
      store.close();
    }
  });

program
  .command("nodes")
  .description("List a run's node executions")
  .argument("<run>", "run id")
  .option("--status <status>", "filter by status")
  .option("-j, --json", "JSON output")
  .action((runId: string, opts: { status?: string; json?: boolean }) => {
    const { store } = openLocal();
    try {
      const nodes = store.listRunNodes(runId).filter((n) => (opts.status ? n.status === opts.status : true));
      if (opts.json) {
        console.log(JSON.stringify(nodes, null, 2));
      } else {
        for (const node of nodes) {
          console.log(`${node.status.padEnd(10)} ${node.nodeId}  attempts=${node.attempts}  lane=${node.lane ?? "-"}  exit=${node.exitCode ?? "-"}`);
        }
      }
    } finally {
      store.close();
    }
  });

program
  .command("daemon")
  .description("Run or inspect the daemon")
  .argument("<action>", "start | status | stop")
  .option("--once", "run a single reap cycle and exit (start)")
  .option("--interval-ms <n>", "reap interval (start)", "5000")
  .option("--cycles <n>", "bound on consecutive cycles (start; default infinite until SIGINT)", "0")
  .option("-j, --json", "JSON output")
  .action(async (action: string, opts: { once?: boolean; intervalMs?: string; cycles?: string; json?: boolean }) => {
    const config = resolveWorkflowsConfig();
    const pidFile = join(config.dataDir, "daemon.pid");
    const statusFile = join(config.dataDir, "daemon.status.json");
    switch (action) {
      case "start": {
        const { store, wal } = openLocal();
        try {
          if (opts.once) {
            const daemon = new WorkflowsDaemon(store, wal);
            const report = await daemon.reap();
            writeReport(statusFile, report);
            console.log(JSON.stringify(report, null, 2));
            return;
          }
          mkdirSync(config.dataDir, { recursive: true });
          writeFileSync(pidFile, String(process.pid) + "\n", "utf8");
          const intervalMs = Number(opts.intervalMs ?? 5000);
          const cycles = Number(opts.cycles ?? 0);
          const daemon = new WorkflowsDaemon(store, wal);
          let ran = 0;
          console.log(`daemon ${process.pid} started (interval ${intervalMs}ms)`);
          const stop = () => {
            cleanup();
            process.exit(0);
          };
          process.on("SIGINT", stop);
          process.on("SIGTERM", stop);
          const cleanup = () => {
            try {
              rmSync(pidFile, { force: true });
            } catch {
              /* best effort */
            }
          };
          for (;;) {
            const report = await daemon.reap();
            writeReport(statusFile, report);
            ran++;
            if (opts.json) console.log(JSON.stringify(report));
            if (cycles > 0 && ran >= cycles) {
              cleanup();
              process.exit(0);
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
          }
        } finally {
          store.close();
        }
      }
      case "status": {
        if (!existsSync(statusFile)) {
          if (opts.json) {
            console.log(JSON.stringify({ running: false, lastReap: null }));
          } else {
            console.log("daemon not running (no status record)");
          }
          return;
        }
        const lastReap = JSON.parse(readFileSync(statusFile, "utf8")) as ReapReport;
        const pid = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : null;
        const running = pid !== null && processAlive(Number(pid));
        if (opts.json) {
          console.log(JSON.stringify({ running, pid, lastReap }, null, 2));
        } else {
          console.log(`daemon ${running ? `running (pid ${pid})` : "not running"} — last reap: ${JSON.stringify(lastReap)}`);
        }
        return;
      }
      case "stop": {
        if (!existsSync(pidFile)) {
          console.error("no daemon pid file — nothing to stop");
          process.exit(1);
        }
        const pid = Number(readFileSync(pidFile, "utf8").trim());
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          console.error(`cannot signal pid ${pid}`);
          process.exit(1);
        }
        console.log(`stopping daemon ${pid}`);
        return;
      }
      default:
        throw new Error(`unknown daemon action ${action} (expected start | status | stop)`);
    }
  });

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeReport(statusFile: string, report: ReapReport): void {
  mkdirSync(join(statusFile, ".."), { recursive: true });
  writeFileSync(statusFile, JSON.stringify({ ...report, at: new Date().toISOString() }), "utf8");
}

program
  .command("memos")
  .description("Inspect or clear the memoization cache")
  .argument("<action>", "list | clear")
  .option("--yes", "confirm clear")
  .option("-j, --json", "JSON output")
  .action((action: string, opts: { yes?: boolean; json?: boolean }) => {
    const { store } = openLocal();
    try {
      switch (action) {
        case "list": {
          const memos = store.memoList();
          if (opts.json) {
            console.log(JSON.stringify(memos, null, 2));
          } else {
            for (const memo of memos) {
              console.log(`${memo.key}  hits=${memo.hitCount}`);
            }
            console.log(`${memos.length} memo(s)`);
          }
          return;
        }
        case "clear": {
          if (!opts.yes) {
            console.error("refusing without --yes (memos clear is destructive)");
            process.exit(1);
          }
          store.memoClear();
          console.log("memo cache cleared");
          return;
        }
        default:
          throw new Error(`unknown memos action ${action} (expected list | clear)`);
      }
    } finally {
      store.close();
    }
  });

program
  .command("lanes")
  .description("List the four lane adapters and their substrates")
  .argument("[action]", "list (default)")
  .option("-j, --json", "JSON output")
  .action((action: string | undefined, opts: { json?: boolean }) => {
    const inventory = laneInventory();
    if (opts.json || action === "list") {
      console.log(JSON.stringify(inventory, null, 2));
    } else {
      for (const lane of inventory) {
        console.log(`${lane.kind.padEnd(8)} ${lane.sdk}  ->  ${lane.substrate}`);
      }
    }
  });

program
  .command("repair")
  .description("Repair torn runs (running runs whose claim is gone)")
  .option("--max-attempts <n>", "retry budget before failing a torn run", "3")
  .option("-j, --json", "JSON output")
  .action((opts: { maxAttempts?: string; json?: boolean }) => {
    const { store, wal } = openLocal();
    try {
      const report = repairTornRuns(store, wal, { maxAttempts: Number(opts.maxAttempts ?? 3) });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`interrupted=${report.interrupted} requeued=${report.requeued} failed=${report.failed}`);
      }
    } finally {
      store.close();
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
