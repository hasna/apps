#!/usr/bin/env bun
/**
 * workflows — the CLI surface of @hasna/workflows.
 *
 * Answers --version/--help before anything else and binds nothing. Commands:
 * init, validate, graph (render), run, runs (list|show|cancel|resume|events),
 * nodes (list|show), sessions (list|pull), machines (list|status), lanes
 * (list|probe), daemon (start|status|stop), memos (list|clear), resume
 * (interrupted-run restore), serve, repair — plus the shell commands
 * version/health/info.
 */
import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createWorkflowsService, packageVersion, resolveWorkflowsConfig } from "../service.js";
import { validateGraph, type WorkflowGraph } from "../graph.js";
import { renderGraphDot, renderGraphJson, renderGraphText } from "../render.js";
import { openStore } from "../store.js";
import { SessionWAL, SESSIONS_DIR_NAME } from "../wal.js";
import { findRunByIdempotencyKey, repairTornRuns, resetRunNodes, restoreInterruptedRun } from "../session.js";
import { runGraphToCompletion, WorkflowsDaemon, type ReapReport } from "../daemon.js";
import { laneInventory, probeLane } from "../lanes/index.js";
import { LANE_KINDS } from "../lanes/types.js";
import { createWorkflowsServer } from "../serve/server.js";

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

// -- helpers ----------------------------------------------------------------

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

function collectInput(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Parse --input k=v entries into a context object (later keys win). */
function parseInputs(raw: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of raw) {
    const eq = entry.indexOf("=");
    if (eq <= 0) throw new Error(`--input expects k=v, got ${JSON.stringify(entry)}`);
    out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

/** Merge --input entries over the --context JSON (inputs win). */
function mergeRunContext(contextRaw: string | undefined, inputs: string[]): Record<string, unknown> {
  return { ...parseContext(contextRaw), ...parseInputs(inputs) };
}

/** Inject the idempotency key into the reserved __wf context namespace. */
function withIdempotencyKey(context: Record<string, unknown>, key: string): Record<string, unknown> {
  return {
    ...context,
    __wf: { ...((context.__wf as Record<string, unknown> | undefined) ?? {}), idempotencyKey: key },
  };
}

function runSummary(row: { id: string; status: string; error: string | null; resultJson: string | null }) {
  return {
    runId: row.id,
    status: row.status,
    error: row.error ?? null,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  };
}

// -- graph commands ---------------------------------------------------------

program
  .command("init")
  .description("Create the store layout (workflows/, sessions/, workflows.db) and scaffold a sample graph")
  .argument("[file]", "sample graph output path (default <dataDir>/workflows/demo.json)")
  .action((file: string | undefined) => {
    const config = resolveWorkflowsConfig();
    // the specified data-dir layout: workflows/ + sessions/ + workflows.db
    mkdirSync(join(config.dataDir, "workflows"), { recursive: true });
    mkdirSync(join(config.dataDir, SESSIONS_DIR_NAME), { recursive: true });
    // create the store eagerly — init owns the layout, so workflows.db exists
    // from the first run; the session WAL is created by its first append.
    const store = openStore(config.dataDir);
    store.close();
    const target = file ?? join(config.dataDir, "workflows", "demo.json");
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
    console.log(`store layout ready at ${config.dataDir} (workflows/, sessions/, workflows.db)`);
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
  .command("graph")
  .description("Render a workflow graph (text, DOT, or JSON)")
  .argument("<file>", "graph JSON file")
  .option("--format <format>", "text | dot | json (default text)", "text")
  .option("-j, --json", "JSON output (shorthand for --format json)")
  .action((file: string, opts: { format?: string; json?: boolean }) => {
    const graph = loadGraph(file);
    const validation = validateGraph(graph);
    if (!validation.ok) {
      console.error(`graph is invalid; rendering the structure as-is (${validation.issues.length} issue(s))`);
    }
    const format = opts.json ? "json" : (opts.format ?? "text");
    switch (format) {
      case "text":
        console.log(renderGraphText(graph));
        return;
      case "dot":
        console.log(renderGraphDot(graph));
        return;
      case "json":
        console.log(JSON.stringify(renderGraphJson(graph), null, 2));
        return;
      default:
        throw new Error(`unknown --format ${format} (expected text | dot | json)`);
    }
  });

program
  .command("run")
  .description("Run a workflow graph to a terminal state (bounded)")
  .argument("<file>", "graph JSON file")
  .option("--context <json>", "JSON context object for the run")
  .option("--input <k=v>", "run input key=value (repeatable; merged over --context)", collectInput, [])
  .option("--idempotency-key <key>", "re-run with the same key returns the existing run")
  .option("--max-cycles <n>", "bound on reap cycles", "500")
  .option("-j, --json", "JSON output")
  .action(
    async (file: string, opts: { context?: string; input?: string[]; idempotencyKey?: string; maxCycles?: string; json?: boolean }) => {
      const graph = loadGraph(file);
      const validation = validateGraph(graph);
      if (!validation.ok) {
        throw new Error(`graph validation failed: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
      }
      const context = mergeRunContext(opts.context, opts.input ?? []);
      const { store, wal } = openLocal();
      try {
        if (opts.idempotencyKey) {
          const existing = findRunByIdempotencyKey(store, opts.idempotencyKey);
          if (existing) {
            const summary = { ...runSummary(existing), reused: true };
            if (opts.json) {
              console.log(JSON.stringify(summary, null, 2));
            } else {
              console.log(`reused run ${existing.id}: ${existing.status}`);
            }
            if (existing.status !== "completed") process.exit(1);
            return;
          }
        }
        const contextWithKey = opts.idempotencyKey ? withIdempotencyKey(context, opts.idempotencyKey) : context;
        const maxCycles = Number(opts.maxCycles ?? 500);
        const final = await runGraphToCompletion(store, wal, graph, contextWithKey, { maxCycles });
        const summary = runSummary(final);
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
    },
  );

program
  .command("runs")
  .description("Manage runs")
  .argument("<action>", "list | show | cancel | resume | events")
  .argument("[id]", "run id (show/cancel/resume/events)")
  .option("--status <status>", "filter by status (list)")
  .option("--limit <n>", "max rows (list)", "100")
  .option("-j, --json", "JSON output")
  .action((action: string, id: string | undefined, opts: { status?: string; limit?: string; json?: boolean }) => {
    const { store, wal } = openLocal();
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
        case "events": {
          if (!id) throw new Error("runs events requires a run id");
          const run = store.getRun(id);
          if (!run) throw new Error(`no such run ${id}`);
          const events = wal
            .replay()
            .entries.filter((entry) => {
              const op = entry.op as { runId?: string };
              return typeof op.runId === "string" && op.runId === id;
            })
            .map((entry) => ({ seq: entry.seq, at: entry.at, op: entry.op }));
          if (opts.json) {
            console.log(JSON.stringify(events, null, 2));
          } else {
            for (const event of events) {
              console.log(`${event.seq.toString().padStart(4)} ${event.at}  ${JSON.stringify(event.op)}`);
            }
            console.log(`${events.length} event(s)`);
          }
          return;
        }
        default:
          throw new Error(`unknown runs action ${action} (expected list | show | cancel | resume | events)`);
      }
    } finally {
      store.close();
    }
  });

program
  .command("nodes")
  .description("List or show a run's node executions")
  .argument("[action]", "list | show (default list)")
  .argument("[run]", "run id")
  .argument("[node]", "node id (show)")
  .option("--status <status>", "filter by status (list)")
  .option("-j, --json", "JSON output")
  .action((action: string | undefined, run: string | undefined, node: string | undefined, opts: { status?: string; json?: boolean }) => {
    // backward-compatible bare form: `nodes <run>` == `nodes list <run>`
    if (action !== "list" && action !== "show") {
      node = run;
      run = action;
      action = "list";
    }
    if (!run) throw new Error("nodes requires a run id");
    const { store } = openLocal();
    try {
      if (action === "show") {
        if (!node) throw new Error("nodes show requires a run id and a node id");
        const row = store.listRunNodes(run).find((n) => n.nodeId === node);
        if (!row) throw new Error(`run ${run} has no node ${node}`);
        console.log(JSON.stringify(row, null, 2));
        return;
      }
      const nodes = store.listRunNodes(run).filter((n) => (opts.status ? n.status === opts.status : true));
      if (opts.json) {
        console.log(JSON.stringify(nodes, null, 2));
      } else {
        for (const n of nodes) {
          console.log(`${n.status.padEnd(10)} ${n.nodeId}  attempts=${n.attempts}  lane=${n.lane ?? "-"}  exit=${n.exitCode ?? "-"}`);
        }
      }
    } finally {
      store.close();
    }
  });

program
  .command("sessions")
  .description("Inspect the session WAL")
  .argument("<action>", "list | pull")
  .option("-j, --json", "JSON output")
  .action((action: string, opts: { json?: boolean }) => {
    const { wal } = openLocal();
    const replay = wal.replay();
    switch (action) {
      case "list": {
        const entries = replay.entries.map((entry) => ({ seq: entry.seq, at: entry.at, op: entry.op }));
        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          for (const entry of entries) {
            console.log(`${entry.seq.toString().padStart(4)} ${entry.at}  ${JSON.stringify(entry.op)}`);
          }
          console.log(`${entries.length} WAL entry(ies)`);
        }
        return;
      }
      case "pull": {
        const liveClaims = [...replay.liveClaims().entries()].map(([runId, claim]) => ({
          runId,
          worker: claim.worker,
          fencing: claim.fencing,
          expiresAt: new Date(claim.expiresAtMs).toISOString(),
        }));
        const report = {
          entries: replay.entries.length,
          torn: replay.torn,
          repaired: replay.repaired,
          liveClaims,
          walFile: wal.filePath,
        };
        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(`sessions pull: ${report.entries} WAL entr${report.entries === 1 ? "y" : "ies"}` +
            `  torn=${report.torn}  repaired=${report.repaired}  liveClaims=${report.liveClaims.length}`);
          for (const claim of report.liveClaims) {
            console.log(`  claim ${claim.runId} by ${claim.worker} until ${claim.expiresAt} (fencing ${claim.fencing})`);
          }
        }
        return;
      }
      default:
        throw new Error(`unknown sessions action ${action} (expected list | pull)`);
    }
  });

program
  .command("machines")
  .description("List observed machines or report this machine's workflows status")
  .argument("<action>", "list | status")
  .option("-j, --json", "JSON output")
  .action((action: string, opts: { json?: boolean }) => {
    const config = resolveWorkflowsConfig();
    const { store, wal } = openLocal();
    try {
      switch (action) {
        case "list": {
          // observed machines = distinct daemon workers recorded in WAL claims
          const seen = new Map<string, { lastSeenAt: string; claims: number }>();
          for (const entry of wal.replay().entries) {
            const op = entry.op;
            if (op.op === "claim_acquired") {
              const prev = seen.get(op.worker);
              seen.set(op.worker, { lastSeenAt: op.at, claims: (prev?.claims ?? 0) + 1 });
            }
          }
          const local = hostname();
          const rows = [
            { name: local, local: true, dataDir: config.dataDir, lastSeenAt: null, claims: 0 },
            ...[...seen.entries()].map(([name, info]) => ({
              name,
              local: name === local,
              dataDir: null,
              lastSeenAt: info.lastSeenAt,
              claims: info.claims,
            })),
          ];
          if (opts.json) {
            console.log(JSON.stringify(rows, null, 2));
          } else {
            for (const row of rows) {
              console.log(`${row.local ? "local " : "      "} ${row.name}  claims=${row.claims}  lastSeen=${row.lastSeenAt ?? "-"}`);
            }
          }
          return;
        }
        case "status": {
          const replay = wal.replay();
          const pidFile = join(config.dataDir, "daemon.pid");
          const pid = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : null;
          const running = pid !== null && processAlive(Number(pid));
          const report = {
            hostname: hostname(),
            pid: process.pid,
            dataDir: config.dataDir,
            layout: {
              workflows: existsSync(join(config.dataDir, "workflows")),
              sessions: existsSync(join(config.dataDir, SESSIONS_DIR_NAME)),
              db: existsSync(join(config.dataDir, "workflows.db")),
            },
            store: {
              tables: store.listTables(),
              runs: store.listRuns({ limit: 1000 }).length,
              nodes: store.listRunNodes,
            },
            wal: { entries: replay.entries.length, torn: replay.torn, repaired: replay.repaired },
            daemon: { running, pid },
          };
          if (opts.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            console.log(`machine ${report.hostname} (pid ${report.pid})`);
            console.log(`  dataDir   ${report.dataDir}`);
            console.log(`  layout    workflows=${report.layout.workflows} sessions=${report.layout.sessions} db=${report.layout.db}`);
            console.log(`  store     tables=${report.store.tables.join(",")} runs=${report.store.runs}`);
            console.log(`  wal       ${report.wal.entries} entr${report.wal.entries === 1 ? "y" : "ies"} torn=${report.wal.torn}`);
            console.log(`  daemon    ${report.daemon.running ? `running (pid ${report.daemon.pid})` : "not running"}`);
          }
          return;
        }
        default:
          throw new Error(`unknown machines action ${action} (expected list | status)`);
      }
    } finally {
      store.close();
    }
  });

program
  .command("lanes")
  .description("List the four lane adapters (wired vs not-ready-with-reason) or probe one")
  .argument("[action]", "list | probe (default list)")
  .argument("[lane]", "lane to probe (claude | codex | cursor | grok)")
  .option("-j, --json", "JSON output")
  .action(async (action: string | undefined, lane: string | undefined, opts: { json?: boolean }) => {
    if (action === "probe") {
      const kind = lane as never;
      if (!LANE_KINDS.includes(kind)) {
        throw new Error(`unknown lane ${lane} (expected one of ${LANE_KINDS.join(", ")})`);
      }
      const probe = await probeLane(kind);
      if (opts.json) {
        console.log(JSON.stringify(probe, null, 2));
      } else if (probe.wired) {
        console.log(`${probe.kind}: wired (${probe.via})`);
      } else {
        console.log(`${probe.kind}: NOT wired — ${probe.reason}`);
        process.exitCode = 1;
      }
      return;
    }
    if (action !== undefined && action !== "list") {
      throw new Error(`unknown lanes action ${action} (expected list | probe)`);
    }
    const inventory = await laneInventory();
    if (opts.json) {
      console.log(JSON.stringify(inventory, null, 2));
    } else {
      for (const laneProbe of inventory) {
        if (laneProbe.wired) {
          console.log(`${laneProbe.kind.padEnd(8)} wired (${laneProbe.via})`);
        } else {
          console.log(`${laneProbe.kind.padEnd(8)} NOT wired — ${laneProbe.reason}`);
        }
      }
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
  .command("resume")
  .description("Restore an INTERRUPTED run from its durable cursor, reusing memoized node outputs")
  .argument("<run-id>", "run id")
  .option("-j, --json", "JSON output")
  .action((runId: string, opts: { json?: boolean }) => {
    const { store } = openLocal();
    try {
      const restored = restoreInterruptedRun(store, runId);
      if (opts.json) {
        console.log(JSON.stringify(restored, null, 2));
      } else {
        console.log(
          `restored ${restored.runId} to ${restored.status} (nodesRestored=${restored.nodesRestored}, memoizedNodes=${restored.memoizedNodes}, attempts=${restored.attempts})`,
        );
      }
    } finally {
      store.close();
    }
  });

program
  .command("serve")
  .description("Start the HTTP server surface (same as the workflows-serve bin)")
  .option("--port <n>", "bind port (default from config)")
  .option("--host <h>", "bind host (default 127.0.0.1)")
  .action(async (opts: { port?: string; host?: string }) => {
    const service = createWorkflowsService({
      port: opts.port !== undefined ? Number(opts.port) : undefined,
      host: opts.host,
    });
    const server = createWorkflowsServer(service);
    console.log(`workflows-serve listening on http://${service.config.host}:${server.port}`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        server.stop();
        resolve();
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
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
