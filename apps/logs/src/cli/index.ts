#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import { streamServerEvents } from "../lib/event-stream-client.ts";
import type { CliEventWatchFilter } from "../lib/event-watch.ts";
import type { EventCatalogEntry } from "../lib/events.ts";
import { PACKAGE_VERSION } from "../lib/package-meta.ts";
import type { StructuredLogFormat } from "../lib/structured-logs.ts";
import type {
  UniversalEventInput,
  UniversalEventType,
} from "../lib/universal-ingest.ts";
import {
  type Store,
  requireLocalStore,
  resolveLogsTransport,
  resolveStore,
} from "../store/index.ts";
import type { LogLevel, LogSource } from "../types/index.ts";

// ── Color helpers ──────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bgRed: "\x1b[41m\x1b[97m",
  magenta: "\x1b[35m",
};
const LEVEL_COLOR: Record<string, string> = {
  fatal: C.bgRed,
  error: C.red,
  warn: C.yellow,
  info: "",
  debug: C.gray,
};
function colorRow(ts: string, level: string, svc: string, msg: string): string {
  const lc = LEVEL_COLOR[level.toLowerCase()] ?? "";
  const isTTY = process.stdout.isTTY;
  if (!isTTY)
    return `${ts}  ${pad(level.toUpperCase(), 5)}  ${pad(svc, 12)}  ${msg}`;
  return `${C.dim}${ts}${C.reset}  ${lc}${C.bold}${pad(level.toUpperCase(), 5)}${C.reset}  ${C.cyan}${pad(svc, 12)}${C.reset}  ${msg}`;
}
function colorLevel(level: string): string {
  if (!process.stdout.isTTY) return pad(level.toUpperCase(), 5);
  const lc = LEVEL_COLOR[level.toLowerCase()] ?? "";
  return `${lc}${C.bold}${pad(level.toUpperCase(), 5)}${C.reset}`;
}

/**
 * The unified data-plane {@link Store}: ApiStore (HTTP /v1 + bearer key) when
 * the @hasna/contracts client transport resolves a credential (Keychain,
 * ~/.hasna/logs/config/credentials, HASNA_LOGS_API_KEY — the authority
 * defaults to the fleet gateway https://api.hasna.com/logs), LocalStore
 * (SQLite) only under the EXPLICIT opt-in HASNA_LOGS_LOCAL=1 (alias
 * LOGS_LOCAL). Running without a resolvable fleet credential and without the
 * opt-in FAILS CLOSED with an actionable error (owner ruling 2026-09-04) —
 * the CLI never silently serves the local store (~/.hasna/logs/logs.db), and
 * a run that does serve it says "local" once on stderr. Every data-plane
 * command routes through this — no per-command transport branching, no
 * `getDb()` in handlers.
 *
 * The store is resolved LAZILY on first data-plane use so that meta and
 * non-data-plane invocations (`--help`/`--version`, `db migrate`/`db status`
 * schema admin, `db doctor *` local maintenance, `mcp`, `serve`, and the
 * explicit `watch --server` SSE tail) keep working without a fleet
 * credential.
 *
 * The event-catalog maintenance commands (`db doctor segments`,
 * `db doctor rebuild-index`, `db doctor repair-segments`) call
 * `requireLocalStore(cmd)` instead: their subject — the raw JSONL segment
 * files and SQLite projections — exists only on the on-box backend, so they
 * throw loudly in api mode rather than touch a stale local db, and require
 * HASNA_LOGS_LOCAL=1 when no credential resolves (see src/store/index.ts for
 * the recorded strong reason).
 */
let store: Store | null = null;
function getStore(): Store {
  store ??= resolveStore();
  return store;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseJsonObjectOption(
  value: string | undefined,
  label: string,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseOptionalNonNegativeInt(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    String(parsed) !== value.trim()
  ) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveIntOption(
  value: string | undefined,
  label: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    String(parsed) !== value.trim()
  ) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function createRunAbortController(): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const onSigint = () => abortRun(controller, "SIGINT");
  const onSigterm = () => abortRun(controller, "SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return {
    signal: controller.signal,
    cleanup: () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    },
  };
}

function abortRun(
  controller: AbortController,
  signal: "SIGINT" | "SIGTERM",
): void {
  if (controller.signal.aborted) {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
  controller.abort(signal);
}

const program = new Command()
  .name("logs")
  .description("@hasna/logs — log aggregation and monitoring")
  .version(PACKAGE_VERSION);

// ── logs list ──────────────────────────────────────────────
program
  .command("list")
  .description("Search and list logs")
  .option("--project <name|id>", "Filter by project name or ID")
  .option("--page <id>", "Filter by page ID")
  .option(
    "--level <levels>",
    "Comma-separated levels (error,warn,info,debug,fatal)",
  )
  .option("--service <name>", "Filter by service")
  .option("--since <iso>", "Since timestamp or relative (1h, 24h, 7d)")
  .option(
    "--until <iso>",
    "Until timestamp or relative (e.g. logs list --since 2h --until 1h)",
  )
  .option("--text <query>", "Full-text search")
  .option("--limit <n>", "Max results", "100")
  .option("--format <fmt>", "Output format: table|json|compact", "table")
  .option("--json", "Output as JSON (alias for --format json)")
  .action(async (opts) => {
    const rows = await getStore().listLogs({
      project_id: await getStore().resolveProjectId(opts.project),
      page_id: opts.page,
      level: opts.level ? (opts.level.split(",") as LogLevel[]) : undefined,
      service: opts.service,
      since: parseRelativeTime(opts.since),
      until: parseRelativeTime(opts.until),
      text: opts.text,
      limit: Number(opts.limit),
    });
    if (opts.json || opts.format === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (opts.format === "compact") {
      for (const r of rows)
        console.log(
          `${r.timestamp} [${r.level.toUpperCase()}] ${r.service ?? "-"} ${r.message}`,
        );
      return;
    }
    for (const r of rows) {
      const meta = r.metadata ? ` ${r.metadata}` : "";
      console.log(
        `${colorRow(r.timestamp, r.level, r.service ?? "-", r.message)}${meta}`,
      );
    }
    console.log(`\n${rows.length} log(s)`);
  });

// ── logs tail ──────────────────────────────────────────────
program
  .command("tail")
  .description("Show most recent logs")
  .option("--project <name|id>", "Project name or ID")
  .option("--n <count>", "Number of logs", "50")
  .action(async (opts) => {
    const rows = await getStore().tailLogs(
      await getStore().resolveProjectId(opts.project),
      Number(opts.n),
    );
    for (const r of rows)
      console.log(colorRow(r.timestamp, r.level, r.service ?? "-", r.message));
  });

// ── logs summary ──────────────────────────────────────────
program
  .command("summary")
  .description("Error/warn summary by service")
  .option("--project <name|id>", "Project name or ID")
  .option("--since <time>", "Relative time (1h, 24h, 7d)", "24h")
  .option("--until <time>", "Upper bound time")
  .action(async (opts) => {
    const summary = await getStore().summarize(
      await getStore().resolveProjectId(opts.project),
      parseRelativeTime(opts.since),
      parseRelativeTime(opts.until),
    );
    if (!summary.length) {
      console.log("No errors/warnings in this window.");
      return;
    }
    for (const s of summary)
      console.log(
        `${colorLevel(s.level)} ${C.cyan}${pad(s.service ?? "-", 15)}${C.reset} count=${s.count} latest=${s.latest}`,
      );
  });

// ── logs push ─────────────────────────────────────────────
program
  .command("push <message>")
  .description("Push a log entry")
  .option("--id <id>", "Producer event ID")
  .option("--timestamp <iso>", "Producer event timestamp")
  .option("--level <level>", "Log level", "info")
  .option("--service <name>")
  .option("--project <name|id>", "Project name or ID")
  .option("--trace <id>", "Trace ID")
  .action(async (message, opts) => {
    const row = await getStore().ingestLog({
      id: opts.id,
      timestamp: opts.timestamp,
      level: opts.level as LogLevel,
      message,
      service: opts.service,
      project_id: await getStore().resolveProjectId(opts.project),
      trace_id: opts.trace,
    });
    console.log(`Logged: ${row.id}`);
  });

// ── logs get ──────────────────────────────────────────────
program
  .command("get <id>")
  .description("Fetch one log entry by id")
  .option("--format <fmt>", "Output format: json|table", "json")
  .option("--json", "Output as JSON (alias for --format json)")
  .action(async (id, opts) => {
    const row = await getStore().getLog(id);
    if (!row) {
      console.error(`Log not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    if (opts.format === "table" && !opts.json) {
      console.log(
        colorRow(row.timestamp, row.level, row.service ?? "-", row.message),
      );
      return;
    }
    console.log(JSON.stringify(row, null, 2));
  });

// ── logs delete ───────────────────────────────────────────
program
  .command("delete <id>")
  .alias("rm")
  .description("Delete one log entry by id")
  .action(async (id) => {
    const ok = await getStore().deleteLog(id);
    if (!ok) {
      console.error(`Log not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Deleted: ${id}`);
  });

// ── logs import-jsonl ─────────────────────────────────────
program
  .command("import-jsonl <file>")
  .description("Import Pino/Winston/generic structured JSONL logs")
  .option("--format <format>", "Input format: auto|pino|winston|json", "auto")
  .option("--source <source>", "Telemetry source override")
  .option("--service <name>", "Service name override")
  .option("--project <name|id>", "Project name or ID")
  .option("--machine <id>", "Machine identity override")
  .option("--repo <id>", "Repository identity override")
  .option("--app <id>", "Application identity override")
  .option("--process <id>", "Process identity override")
  .option("--run <id>", "Run identity override")
  .option("--environment <name>", "Environment label")
  .option("--release <id>", "Release/version identity")
  .option("--metadata <json>", "Additional metadata JSON object")
  .option("--follow", "Poll the file and ingest appended JSONL records")
  .option("--from-end", "With --follow, start at the current end of file")
  .option(
    "--poll <ms>",
    "With --follow, polling interval in milliseconds",
    "250",
  )
  .option(
    "--idle-timeout <ms>",
    "With --follow, stop after this many idle milliseconds",
  )
  .option(
    "--max-lines <n>",
    "With --follow, stop after importing this many non-empty JSONL records",
  )
  .option("--json", "Print import summary as JSON")
  .action(async (file, opts) => {
    try {
      const metadata = parseJsonObjectOption(opts.metadata, "--metadata");
      const ingestOptions = {
        format: opts.format as StructuredLogFormat,
        source: opts.source as LogSource | undefined,
        service: opts.service,
        project_id: await getStore().resolveProjectId(opts.project),
        machine_id: opts.machine,
        repo_id: opts.repo,
        app_id: opts.app,
        process_id: opts.process,
        run_id: opts.run,
        environment: opts.environment,
        release_id: opts.release,
        metadata,
      };
      let summary: {
        inserted: number;
        ids: string[];
        lines_read?: number;
        bytes_read?: number;
        truncated?: number;
      };
      if (opts.follow) {
        if (file === "-") throw new Error("--follow requires a file path");
        summary = await getStore().followStructuredLogs(file, {
          ...ingestOptions,
          from_end: Boolean(opts.fromEnd),
          poll_ms: parsePositiveIntOption(opts.poll, "--poll", 250),
          idle_timeout_ms: parseOptionalNonNegativeInt(
            opts.idleTimeout,
            "--idle-timeout",
          ),
          max_lines: parseOptionalNonNegativeInt(opts.maxLines, "--max-lines"),
          source_name: file,
        });
      } else {
        const input =
          file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
        summary = await getStore().importStructuredLogs(
          input,
          ingestOptions,
          file === "-" ? "stdin" : file,
        );
      }
      if (opts.json) {
        printJson(summary);
      } else {
        console.log(`Imported ${summary.inserted} log(s) from ${file}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

// ── logs run ──────────────────────────────────────────────
program
  .command("run")
  .description("Run a command and capture process/stdout/stderr telemetry")
  .argument("<cmd...>", "Command to run. Use: logs run -- <cmd> [...args]")
  .option("--project <name|id>", "Project name or ID")
  .option("--service <name>", "Service name for stdout/stderr log events")
  .option("--cwd <path>", "Working directory for the command")
  .option(
    "--environment <name>",
    "Environment label",
    process.env.NODE_ENV ?? "development",
  )
  .option("--json", "Print run summary as JSON")
  .option("--no-tee", "Do not mirror child stdout/stderr to this terminal")
  .allowUnknownOption(true)
  .action(async (cmd: string[], opts) => {
    const runAbort = createRunAbortController();
    let result: Awaited<ReturnType<Store["runCapturedCommand"]>>;
    try {
      result = await getStore().runCapturedCommand(cmd, {
        cwd: opts.cwd,
        project_id: await getStore().resolveProjectId(opts.project),
        service: opts.service,
        environment: opts.environment,
        tee: opts.json ? false : opts.tee !== false,
        signal: runAbort.signal,
      });
    } finally {
      runAbort.cleanup();
    }

    if (opts.json) {
      printJson(result);
    } else {
      process.stderr.write(
        `\nlogs run: ${result.status} exit=${result.exit_code} run=${result.run_id} process=${result.process_id}\n`,
      );
    }

    if (result.exit_code !== 0) {
      process.exitCode = result.exit_code;
    } else if (result.signal === "SIGINT") {
      process.exitCode = 130;
    } else if (result.signal === "SIGTERM") {
      process.exitCode = 143;
    }
  });

// ── cloud database (server-side schema admin, in-VPC only) ─
const dbCmd = program
  .command("db")
  .description("Server-side Postgres schema commands (in-VPC admin only)");

dbCmd
  .command("migrate")
  .description("Apply pending cloud Postgres migrations (schema + api_keys)")
  .option("--dry-run", "Report the plan without applying anything")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { runLogsCloudMigrations } = await import("../db/pg-migrate.ts");
    const result = await runLogsCloudMigrations({
      dryRun: Boolean(opts.dryRun),
    });
    const applied = result.plan
      .filter((item) => item.state === "pending")
      .map((item) => item.migration.id);
    if (opts.json) {
      printJson({
        dryRun: result.dryRun,
        pending: applied,
        appliedCount: result.dryRun ? 0 : applied.length,
        ledger: result.applied.map((m) => m.id),
      });
      return;
    }
    if (result.dryRun) {
      console.log(
        applied.length === 0
          ? "Schema up to date; no pending migrations."
          : `Pending migrations: ${applied.join(", ")}`,
      );
    } else {
      console.log(
        applied.length === 0
          ? "Schema already up to date."
          : `Applied ${applied.length} migration(s): ${applied.join(", ")}`,
      );
    }
  });

dbCmd
  .command("status")
  .description("Show applied/pending cloud migrations")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { runLogsCloudMigrations } = await import("../db/pg-migrate.ts");
    const result = await runLogsCloudMigrations({ dryRun: true });
    const pending = result.plan
      .filter((item) => item.state === "pending")
      .map((item) => item.migration.id);
    if (opts.json) {
      printJson({ applied: result.applied.map((m) => m.id), pending });
      return;
    }
    console.log(
      `Applied: ${result.applied.map((m) => m.id).join(", ") || "(none)"}`,
    );
    console.log(`Pending: ${pending.join(", ") || "(none)"}`);
  });

// ── logs doctor ───────────────────────────────────────────
const doctorCmd = program
  .command("doctor")
  .description("Inspect and repair raw telemetry storage");

doctorCmd
  .command("segments")
  .description(
    "Verify raw event segments, manifests, hashes, and SQLite pointers",
  )
  .option("--json", "Output as JSON")
  .action((opts) => {
    const result = requireLocalStore("db doctor segments").verifyEventStore();
    if (opts.json) {
      printJson(result);
    } else {
      console.log(`Raw event store: ${result.ok ? "ok" : "failed"}`);
      console.log(`Checked records: ${result.checked_records}`);
      console.log(`Checked segments: ${result.checked_segments}`);
      if (result.errors.length) {
        console.log("");
        for (const error of result.errors) console.log(`- ${error}`);
      }
    }
    if (!result.ok) process.exitCode = 1;
  });

doctorCmd
  .command("rebuild-index")
  .description(
    "Rebuild SQLite event segment and record indexes from raw JSONL segments",
  )
  .option("--json", "Output as JSON")
  .action((opts) => {
    const local = requireLocalStore("db doctor rebuild-index");
    // Rebuild clears and replays the SQLite projections (logs, issues, spans,
    // test reports, …) from the raw JSONL segments. Snapshot the DB first so a
    // pruned/damaged segment store can never silently drop rows without recourse.
    const backup = local.backupDatabase();
    const rebuild = local.rebuildEventStoreIndex();
    const verification = local.verifyEventStore();
    const result = { backup, rebuild, verification };
    if (opts.json) {
      printJson(result);
    } else {
      if (backup) console.log(`Backup: ${backup}`);
      console.log(`Indexed events: ${rebuild.indexed_events}`);
      console.log(`Indexed segments: ${rebuild.indexed_segments}`);
      console.log(`Skipped events: ${rebuild.skipped_events}`);
      console.log(`Verification: ${verification.ok ? "ok" : "failed"}`);
      for (const error of rebuild.errors) console.log(`- ${error}`);
      if (verification.errors.length) {
        console.log("");
        for (const error of verification.errors) console.log(`- ${error}`);
      }
    }
    if (rebuild.errors.length || !verification.ok) process.exitCode = 1;
  });

doctorCmd
  .command("repair-segments")
  .description(
    "Quarantine malformed or partial raw segment lines and rebuild indexes",
  )
  .option(
    "--apply",
    "Apply repairs. Without this flag, only reports planned repairs",
  )
  .option("--json", "Output as JSON")
  .action((opts) => {
    const result = requireLocalStore(
      "db doctor repair-segments",
    ).repairEventStoreSegments({ apply: opts.apply === true });
    if (opts.json) {
      printJson(result);
    } else {
      console.log(`Repair mode: ${result.applied ? "applied" : "dry-run"}`);
      console.log(`Scanned segments: ${result.scanned_segments}`);
      console.log(`Segments needing repair: ${result.repaired_segments}`);
      console.log(`Quarantined bytes: ${result.quarantined_bytes}`);
      for (const repair of result.repairs) {
        console.log("");
        console.log(`Segment: ${repair.segment_path}`);
        console.log(`  removed lines: ${repair.removed_lines.length}`);
        console.log(`  malformed lines: ${repair.malformed_lines}`);
        console.log(`  partial truncated: ${repair.partial_truncated}`);
        console.log(`  quarantine: ${repair.quarantine_path}`);
      }
      if (!result.applied && result.repaired_segments > 0) {
        console.log("");
        console.log(
          "Run with --apply to rewrite segments and rebuild indexes.",
        );
      }
      if (result.rebuild) {
        console.log("");
        console.log(`Indexed events: ${result.rebuild.indexed_events}`);
        console.log(`Indexed segments: ${result.rebuild.indexed_segments}`);
        console.log(`Skipped events: ${result.rebuild.skipped_events}`);
      }
      if (result.verification) {
        console.log(
          `Verification: ${result.verification.ok ? "ok" : "failed"}`,
        );
      }
      for (const error of result.errors) console.log(`- ${error}`);
    }
    if (
      result.errors.length ||
      (result.rebuild?.errors.length ?? 0) > 0 ||
      (result.applied && result.verification && !result.verification.ok)
    ) {
      process.exitCode = 1;
    }
  });

// ── logs events ───────────────────────────────────────────
const eventsCmd = program
  .command("events")
  .description("Search and export the raw-backed event catalog");

eventsCmd
  .command("push")
  .description("Push one raw-first universal telemetry event")
  .requiredOption(
    "--type <type>",
    "Event type, e.g. exception,span,metric,network,agent",
  )
  .option("--id <id>", "Producer event ID")
  .option("--source-event-id <id>", "Original source event ID")
  .option("--time <iso>", "Producer event timestamp")
  .option("--source <source>", "Source name", "cli")
  .option("--severity <level>", "Severity: debug|info|warn|error|fatal")
  .option("--privacy <tier>", "Privacy tier", "internal")
  .option("--message <text>", "Human-readable message")
  .option("--project <name|id>", "Project name or ID")
  .option("--machine <id>", "Machine ID")
  .option("--repo <id>", "Repository ID")
  .option("--app <id>", "App ID")
  .option("--process <id>", "Process ID")
  .option("--run <id>", "Run ID")
  .option("--trace <id>", "Trace ID")
  .option("--span <id>", "Span ID")
  .option("--parent-span <id>", "Parent span ID")
  .option("--session <id>", "Session ID")
  .option("--release <id>", "Release ID")
  .option("--artifact <id>", "Artifact ID")
  .option("--environment <name>", "Environment")
  .option("--body <json>", "Event body JSON object")
  .option("--attributes <json>", "Event attributes JSON object")
  .action(async (opts) => {
    try {
      const projectId = await getStore().resolveProjectId(opts.project);
      const body = parseJsonObjectOption(opts.body, "--body");
      const attributes = parseJsonObjectOption(opts.attributes, "--attributes");
      const hasExplicitIdentity = Boolean(
        opts.machine || opts.repo || opts.app,
      );
      const eventInput: UniversalEventInput = {
        type: opts.type as UniversalEventType,
        event_id: opts.id,
        source_event_id: opts.sourceEventId,
        event_time: opts.time,
        source: opts.source,
        severity: opts.severity,
        privacy: opts.privacy,
        message: opts.message,
        project_id: projectId,
        machine_id: opts.machine,
        repo_id: opts.repo,
        app_id: opts.app,
        process_id: opts.process,
        run_id: opts.run,
        trace_id: opts.trace,
        span_id: opts.span,
        parent_span_id: opts.parentSpan,
        session_id: opts.session,
        release_id: opts.release,
        artifact_id: opts.artifact,
        environment: opts.environment ?? process.env.NODE_ENV ?? "development",
        body,
        attributes,
      };
      const result = await getStore().pushEvent(eventInput, {
        detectIdentity: !hasExplicitIdentity,
        projectNameOrId: opts.project,
        environment: opts.environment,
      });
      console.log(
        `${result.inserted ? "Event logged" : "Event already exists"}: ${result.event.event_id}`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

eventsCmd
  .command("list")
  .description(
    "Search event_records across event types and identity dimensions",
  )
  .option("--type <types>", "Comma-separated event types, e.g. log,span,metric")
  .option(
    "--source <sources>",
    "Comma-separated sources, e.g. cli,browser,next",
  )
  .option("--severity <levels>", "Comma-separated severities")
  .option("--project <name|id>", "Project name or ID")
  .option("--machine <id>", "Machine ID")
  .option("--repo <id>", "Repository ID")
  .option("--app <id>", "App ID")
  .option("--process <id>", "Process ID")
  .option("--run <id>", "Run ID")
  .option("--trace <id>", "Trace ID")
  .option("--session <id>", "Session ID")
  .option("--environment <name>", "Environment")
  .option("--since <time>", "Since timestamp or relative")
  .option("--until <time>", "Until timestamp or relative")
  .option(
    "--text <query>",
    "Substring search over event id, source id, message, and metadata",
  )
  .option("--include-raw", "Include raw segment envelope")
  .option("--limit <n>", "Max results", "100")
  .option("--format <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = await getStore().listEvents({
      event_type: opts.type,
      source: opts.source,
      severity: opts.severity,
      project_id: await getStore().resolveProjectId(opts.project),
      machine_id: opts.machine,
      repo_id: opts.repo,
      app_id: opts.app,
      process_id: opts.process,
      run_id: opts.run,
      trace_id: opts.trace,
      session_id: opts.session,
      environment: opts.environment,
      since: parseRelativeTime(opts.since),
      until: parseRelativeTime(opts.until),
      text: opts.text,
      include_raw: Boolean(opts.includeRaw),
      limit: Number(opts.limit),
    });
    if (opts.format === "json") {
      printJson(rows);
      return;
    }
    for (const row of rows) {
      console.log(
        `${row.event_time}  ${pad(row.event_type, 10)} ${pad(row.source, 8)} ${pad(row.severity ?? "-", 5)} ${row.event_id}  ${row.message ?? ""}`,
      );
    }
    console.log(`\n${rows.length} event(s)`);
  });

eventsCmd
  .command("get <event_id>")
  .description("Read one event record and reconstruct its raw segment envelope")
  .option("--no-raw", "Do not include the raw envelope")
  .action(async (eventId, opts) => {
    const event = await getStore().getEvent(eventId, opts.raw !== false);
    if (!event) {
      console.error(`Event not found: ${eventId}`);
      process.exitCode = 1;
      return;
    }
    printJson(event);
  });

eventsCmd
  .command("export")
  .description("Export matching event records as JSON")
  .option("--type <types>", "Comma-separated event types")
  .option("--source <sources>", "Comma-separated sources")
  .option("--severity <levels>", "Comma-separated severities")
  .option("--project <name|id>", "Project name or ID")
  .option("--trace <id>", "Trace ID")
  .option("--run <id>", "Run ID")
  .option("--text <query>", "Substring search")
  .option("--since <time>", "Since timestamp or relative")
  .option("--until <time>", "Until timestamp or relative")
  .option("--include-raw", "Include raw segment envelope")
  .option("--limit <n>", "Max results", "100000")
  .option("--output <file>", "Output file (default: stdout)")
  .action(async (opts) => {
    const options = {
      event_type: opts.type,
      source: opts.source,
      severity: opts.severity,
      project_id: await getStore().resolveProjectId(opts.project),
      trace_id: opts.trace,
      run_id: opts.run,
      text: opts.text,
      since: parseRelativeTime(opts.since),
      until: parseRelativeTime(opts.until),
      include_raw: Boolean(opts.includeRaw),
      limit: Number(opts.limit),
    };
    if (opts.output) {
      const { createWriteStream } = await import("node:fs");
      const stream = createWriteStream(opts.output);
      const count = await getStore().exportEvents(options, (s) =>
        stream.write(`${s}\n`),
      );
      stream.end();
      console.error(`Exported ${count} event(s) to ${opts.output}`);
      return;
    }
    const count = await getStore().exportEvents(options, (s) =>
      process.stdout.write(`${s}\n`),
    );
    process.stderr.write(`Exported ${count} event(s)\n`);
  });

// ── logs test-reports ─────────────────────────────────────
const testReportsCmd = program
  .command("test-reports")
  .description("Query projected test-report and bounded test-case metadata");

testReportsCmd
  .command("list")
  .description("List projected test reports")
  .option("--report <id>", "Report ID")
  .option("--event <id>", "Backing event ID")
  .option("--project <name|id>", "Project name or ID")
  .option("--machine <id>", "Machine ID")
  .option("--repo <id>", "Repository ID")
  .option("--app <id>", "App ID")
  .option("--process <id>", "Process ID")
  .option("--run <id>", "Run ID")
  .option("--environment <name>", "Environment")
  .option("--source <source>", "Source")
  .option("--parser <name>", "Parser name")
  .option("--parse-status <status>", "Parse status")
  .option("--path <path>", "Report path")
  .option("--case-status <status>", "Require at least one stored case status")
  .option(
    "--outcome <outcome>",
    "Aggregate report outcome: failed|error|nonpassing|skipped|passed|parse_problem",
  )
  .option("--min-failures <n>", "Minimum aggregate failure count")
  .option("--min-errors <n>", "Minimum aggregate error count")
  .option("--min-skipped <n>", "Minimum aggregate skipped count")
  .option("--since <time>", "Since timestamp or relative")
  .option("--until <time>", "Until timestamp or relative")
  .option("--text <query>", "Substring search over report and case metadata")
  .option("--include-cases", "Include bounded case rows")
  .option("--limit <n>", "Max results", "100")
  .option("--format <fmt>", "Output format: table|json", "table")
  .action(async (opts) => {
    const rows = await getStore().listTestReports({
      report_id: opts.report,
      event_id: opts.event,
      project_id: await getStore().resolveProjectId(opts.project),
      machine_id: opts.machine,
      repo_id: opts.repo,
      app_id: opts.app,
      process_id: opts.process,
      run_id: opts.run,
      environment: opts.environment,
      source: opts.source,
      parser: opts.parser,
      parse_status: opts.parseStatus,
      path: opts.path,
      case_status: opts.caseStatus,
      outcome: opts.outcome,
      min_failures: opts.minFailures ? Number(opts.minFailures) : undefined,
      min_errors: opts.minErrors ? Number(opts.minErrors) : undefined,
      min_skipped: opts.minSkipped ? Number(opts.minSkipped) : undefined,
      since: parseRelativeTime(opts.since),
      until: parseRelativeTime(opts.until),
      text: opts.text,
      include_cases: Boolean(opts.includeCases),
      limit: Number(opts.limit),
    });
    if (opts.format === "json") {
      printJson(rows);
      return;
    }
    for (const report of rows) {
      const counts = `${report.tests ?? "-"} tests/${report.failures ?? "-"} failures/${report.errors ?? "-"} errors`;
      console.log(
        `${report.event_time ?? "-"}  ${pad(report.parse_status ?? "-", 10)} ${pad(report.parser ?? "-", 14)} ${pad(counts, 30)} ${report.id}  ${report.path ?? ""}`,
      );
    }
    console.log(`\n${rows.length} test report(s)`);
  });

testReportsCmd
  .command("get <report_id>")
  .description("Read one projected test report and its bounded case rows")
  .option("--no-cases", "Do not include bounded case rows")
  .action(async (reportId, opts) => {
    const report = await getStore().getTestReport(reportId, opts.cases !== false);
    if (!report) {
      console.error(`Test report not found: ${reportId}`);
      process.exitCode = 1;
      return;
    }
    printJson(report);
  });

// ── logs project ──────────────────────────────────────────
const projectCmd = program.command("project").description("Manage projects");

projectCmd
  .command("create")
  .option("--name <name>", "Project name")
  .option("--repo <url>", "GitHub repo")
  .option("--url <url>", "Base URL")
  .action(async (opts) => {
    if (!opts.name) {
      console.error("--name is required");
      process.exit(1);
    }
    const p = await getStore().createProject({
      name: opts.name,
      github_repo: opts.repo,
      base_url: opts.url,
    });
    console.log(`Created project: ${p.id} — ${p.name}`);
  });

projectCmd.command("list").action(async () => {
  const projects = await getStore().listProjects();
  for (const p of projects)
    console.log(
      `${p.id}  ${p.name}  ${p.base_url ?? ""}  ${p.github_repo ?? ""}`,
    );
});

// ── logs page ─────────────────────────────────────────────
const pageCmd = program.command("page").description("Manage pages");

pageCmd
  .command("add")
  .option("--project <name|id>", "Project name or ID")
  .option("--url <url>")
  .option("--name <name>")
  .action(async (opts) => {
    if (!opts.project || !opts.url) {
      console.error("--project and --url required");
      process.exit(1);
    }
    const projectId = await getStore().resolveProjectId(opts.project);
    if (!projectId) {
      console.error("Project not found");
      process.exit(1);
    }
    const p = await getStore().createPage({
      project_id: projectId,
      url: opts.url,
      name: opts.name,
    });
    console.log(`Page registered: ${p.id} — ${p.url}`);
  });

pageCmd
  .command("list")
  .option("--project <name|id>", "Project name or ID")
  .action(async (opts) => {
    if (!opts.project) {
      console.error("--project required");
      process.exit(1);
    }
    const projectId = await getStore().resolveProjectId(opts.project);
    if (!projectId) {
      console.error("Project not found");
      process.exit(1);
    }
    const pages = await getStore().listPages(projectId);
    for (const p of pages)
      console.log(`${p.id}  ${p.url}  last=${p.last_scanned_at ?? "never"}`);
  });

// ── logs job ──────────────────────────────────────────────
const jobCmd = program.command("job").description("Manage scan jobs");

jobCmd
  .command("create")
  .option("--project <name|id>", "Project name or ID")
  .option("--schedule <cron>", "Cron expression", "*/30 * * * *")
  .action(async (opts) => {
    if (!opts.project) {
      console.error("--project required");
      process.exit(1);
    }
    const projectId = await getStore().resolveProjectId(opts.project);
    if (!projectId) {
      console.error("Project not found");
      process.exit(1);
    }
    const j = await getStore().createJob({
      project_id: projectId,
      schedule: opts.schedule,
    });
    console.log(`Job created: ${j.id} — ${j.schedule}`);
  });

jobCmd
  .command("list")
  .option("--project <name|id>", "Project name or ID")
  .action(async (opts) => {
    const jobs = await getStore().listJobs(
      await getStore().resolveProjectId(opts.project),
    );
    for (const j of jobs)
      console.log(
        `${j.id}  ${j.schedule}  enabled=${j.enabled}  last=${j.last_run_at ?? "never"}`,
      );
  });

// ── logs scan ─────────────────────────────────────────────
program
  .command("scan")
  .description("Run an immediate scan for a job")
  .option("--job <id>")
  .option("--project <name|id>", "Project name or ID")
  .action(async (opts) => {
    if (!opts.job) {
      console.error("--job required");
      process.exit(1);
    }
    const job = await getStore().getScanJob(opts.job);
    if (!job) {
      console.error("Job not found");
      process.exit(1);
    }
    console.log("Running scan...");
    await getStore().runScanJob(job.id, job.project_id, job.page_id ?? undefined);
    console.log("Scan complete.");
  });

// ── logs diagnose ─────────────────────────────────────────
program
  .command("diagnose")
  .description("Health diagnosis: score, top errors, trends, failing pages")
  .option("--project <name|id>", "Project name or ID")
  .option("--since <time>", "Time window (1h, 24h, 7d)", "24h")
  .option(
    "--include <items>",
    "Comma-separated: top_errors,error_rate,failing_pages,perf",
  )
  .action(async (opts) => {
    const projectId = await getStore().resolveProjectId(opts.project);
    if (!projectId) {
      console.error("--project required");
      process.exit(1);
    }
    const include = opts.include ? opts.include.split(",") : undefined;
    const result = await getStore().diagnose(projectId, opts.since, include);
    const scoreColor =
      result.score === "green"
        ? "\x1b[32m"
        : result.score === "yellow"
          ? "\x1b[33m"
          : "\x1b[31m";
    console.log(
      `\n${C.bold}Health:${C.reset} ${scoreColor}${result.score}${C.reset}  errors=${result.error_count} warns=${result.warn_count}`,
    );
    if (result.top_errors?.length) {
      console.log(`\n${C.bold}Top Errors:${C.reset}`);
      for (const e of result.top_errors) {
        console.log(
          `  ${C.red}${pad(String(e.count), 5)}x${C.reset}  ${C.cyan}${pad(e.service ?? "-", 12)}${C.reset}  ${e.message}`,
        );
      }
    }
    if (result.error_rate_by_service.length) {
      console.log(`\n${C.bold}Error Rate By Service:${C.reset}`);
      for (const r of result.error_rate_by_service) {
        const rate =
          r.total > 0 ? ((r.errors / r.total) * 100).toFixed(2) : "0.00";
        console.log(
          `  ${C.cyan}${pad(r.service ?? "-", 12)}${C.reset}  ${rate}%  (${r.errors}/${r.total})`,
        );
      }
    }
    if (result.failing_pages?.length) {
      console.log(`\n${C.bold}Failing Pages:${C.reset}`);
      for (const p of result.failing_pages)
        console.log(
          `  ${C.red}✗${C.reset}  ${p.url}  (${p.error_count} errors)`,
        );
    }
    if (result.perf_regressions?.length) {
      console.log(`\n${C.bold}Perf Regressions:${C.reset}`);
      for (const r of result.perf_regressions)
        console.log(
          `  ${C.yellow}⚠${C.reset}  ${r.url}  score=${r.score_now ?? "-"} delta=${r.delta ?? "-"}`,
        );
    }
    console.log(`\n${result.summary}`);
    console.log("");
  });

// ── logs watch ────────────────────────────────────────────
program
  .command("watch")
  .description("Stream new telemetry events or legacy logs in real time")
  .option(
    "--events",
    "Watch local event catalog records instead of legacy log rows",
  )
  .option(
    "--server <url>",
    "Consume /api/events/stream from a running logs server",
  )
  .option(
    "--token <token>",
    "Bearer token for --server (defaults to HASNA_LOGS_API_TOKEN or LOGS_API_TOKEN)",
  )
  .option(
    "--last-event-id <id>",
    "Resume event catalog watching after this event id",
  )
  .option(
    "--type <types>",
    "Comma-separated event types for event catalog watching",
  )
  .option(
    "--source <sources>",
    "Comma-separated event sources for event catalog watching",
  )
  .option("--project <name|id>", "Filter by project name or ID")
  .option(
    "--level <levels>",
    "Comma-separated levels (debug,info,warn,error,fatal)",
  )
  .option("--service <name>", "Filter by service name")
  .option("--trace <id>", "Filter event catalog records by trace ID")
  .option("--process <id>", "Filter event catalog records by process ID")
  .option("--run <id>", "Filter event catalog records by run ID")
  .option("--session <id>", "Filter event catalog records by session ID")
  .option("--environment <name>", "Filter event catalog records by environment")
  .option("--include-raw", "Request raw event envelopes when using --server")
  .option(
    "--format <fmt>",
    "Output format for event catalog watching: table|json",
    "table",
  )
  .option("--once", "Poll/read once and exit")
  .option(
    "--interval <ms>",
    "Poll interval in milliseconds (default: 500)",
    "500",
  )
  .option("--since <time>", "Start from this time (default: now)")
  .action(async (opts) => {
    // `--server` is an explicit, operator-named out-of-band SSE tail (not the
    // transport-resolved data plane), so it must be reachable on EVERY transport
    // — resolve the project id via the resolved store (best-effort; never throws
    // for the live transport) rather than hard-requiring the local store.
    if (opts.server) {
      // Best-effort name→id resolution for the explicit server tail. The tail
      // targets an operator-named server, so a resolver failure (no fleet env
      // and no local opt-in, or a cloud hiccup) must not crash it — fall back
      // to the raw value. This path never opens a local store by itself.
      let serverProjectId: string | undefined;
      if (opts.project) {
        try {
          serverProjectId = await getStore().resolveProjectId(opts.project);
        } catch {
          serverProjectId = opts.project;
        }
      }
      await watchServerEvents(opts, serverProjectId);
      return;
    }

    // Resolve project name → ID through the resolved store.
    const projectId = opts.project
      ? await getStore().resolveProjectId(opts.project)
      : undefined;

    const COLORS: Record<string, string> = {
      debug: "\x1b[90m",
      info: "\x1b[36m",
      warn: "\x1b[33m",
      error: "\x1b[31m",
      fatal: "\x1b[35m",
    };
    const RESET = "\x1b[0m";
    const BOLD = "\x1b[1m";

    const useEventCatalog = Boolean(
      opts.events ||
        opts.type ||
        opts.source ||
        opts.trace ||
        opts.process ||
        opts.run ||
        opts.session ||
        opts.environment ||
        opts.lastEventId,
    );
    if (useEventCatalog) {
      // The event-catalog live-tail is a transport-resolved data-plane operation:
      // the local tier walks rowid cursors, the hosted tier walks
      // (event_time, event_id) cursors — identical `Store.watchEvents`
      // semantics on both. `watch --server <url>` (SSE) remains available as
      // an explicit out-of-band tail to any logs server.
      await watchEventCatalog(getStore(), opts, projectId);
      return;
    }

    let lastTimestamp = opts.since
      ? new Date(opts.since).toISOString()
      : new Date().toISOString();
    let errorCount = 0;
    let warnCount = 0;
    const pollIntervalMs = Math.max(100, Number(opts.interval) || 500);

    if (!opts.once) process.stdout.write("\x1b[2J\x1b[H"); // clear screen
    console.log(
      `${BOLD}@hasna/logs watch${RESET} — Ctrl+C to exit${projectId ? `  [project: ${opts.project}]` : ""}\n`,
    );

    const poll = async () => {
      const rows = (
        await getStore().listLogs({
          project_id: projectId,
          level: opts.level ? (opts.level.split(",") as LogLevel[]) : undefined,
          service: opts.service,
          since: lastTimestamp,
          limit: 100,
        })
      ).reverse();

      for (const row of rows) {
        if (row.timestamp <= lastTimestamp) continue;
        lastTimestamp = row.timestamp;
        if (row.level === "error" || row.level === "fatal") errorCount++;
        if (row.level === "warn") warnCount++;
        const color = COLORS[row.level] ?? "";
        const ts = row.timestamp.slice(11, 19);
        const svc = (row.service ?? "-").padEnd(12);
        const lvl = row.level.toUpperCase().padEnd(5);
        console.log(
          `${color}${ts}  ${BOLD}${lvl}${RESET}${color}  ${svc}  ${row.message}${RESET}`,
        );
      }

      // Update terminal title with counts
      process.stdout.write(`\x1b]2;logs: ${errorCount}E ${warnCount}W\x07`);
    };

    if (opts.once) {
      await poll();
      return;
    }

    const interval = setInterval(() => {
      void poll().catch((err) =>
        console.error(
          `[logs watch] poll failed, retrying in ${pollIntervalMs}ms: ${(err as Error).message}`,
        ),
      );
    }, pollIntervalMs);
    process.on("SIGINT", () => {
      clearInterval(interval);
      console.log(`\n\nErrors: ${errorCount}  Warnings: ${warnCount}`);
      process.exit(0);
    });
  });

// ── logs count ────────────────────────────────────────────
program
  .command("count")
  .description("Count logs with optional breakdown by level or service")
  .option("--project <name|id>", "Project name or ID")
  .option("--service <name>", "Filter by service")
  .option("--level <level>", "Filter by level")
  .option("--since <time>", "Since (1h, 24h, 7d)")
  .option("--until <time>", "Until")
  .option("--group-by <field>", "Breakdown: level | service")
  .action(async (opts) => {
    const result = await getStore().countLogs({
      project_id: await getStore().resolveProjectId(opts.project),
      service: opts.service,
      level: opts.level,
      since: opts.since,
      until: opts.until,
      group_by: opts.groupBy as "level" | "service" | undefined,
    });
    console.log(
      `Total: ${result.total}  ${C.red}Errors: ${result.errors}${C.reset}  ${C.yellow}Warns: ${result.warns}${C.reset}  Fatals: ${result.fatals}`,
    );
    if (result.by_service) {
      console.log("\nBy Service:");
      for (const [svc, cnt] of Object.entries(result.by_service)) {
        console.log(`  ${C.cyan}${pad(svc, 20)}${C.reset}  ${cnt}`);
      }
    } else if (opts.groupBy === "level") {
      console.log("\nBy Level:");
      for (const [lvl, cnt] of Object.entries(result.by_level)) {
        console.log(`  ${colorLevel(lvl)}  ${cnt}`);
      }
    }
  });

// ── logs export ───────────────────────────────────────────
program
  .command("export")
  .description("Export logs to JSON or CSV")
  .option("--project <name|id>", "Project name or ID")
  .option("--since <time>", "Relative time or ISO")
  .option("--level <level>")
  .option("--service <name>")
  .option("--format <fmt>", "json or csv", "json")
  .option("--output <file>", "Output file (default: stdout)")
  .option("--limit <n>", "Max rows", "100000")
  .action(async (opts) => {
    const { writeFileSync } = await import("node:fs");
    const rows = await getStore().listLogs({
      project_id: await getStore().resolveProjectId(opts.project),
      since: parseRelativeTime(opts.since),
      level: opts.level ? (opts.level as LogLevel) : undefined,
      service: opts.service,
      limit: Number(opts.limit),
    });
    let payload: string;
    if (opts.format === "csv") {
      const cols = [
        "id",
        "timestamp",
        "level",
        "service",
        "message",
        "trace_id",
      ];
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      payload = `${cols.join(",")}\n${rows
        .map((r) =>
          cols
            .map((c) => esc((r as unknown as Record<string, unknown>)[c]))
            .join(","),
        )
        .join("\n")}\n`;
    } else {
      payload = `${JSON.stringify(rows, null, 2)}\n`;
    }
    if (opts.output) {
      writeFileSync(opts.output, payload);
      console.error(`Exported ${rows.length} log(s) to ${opts.output}`);
    } else {
      process.stdout.write(payload);
      process.stderr.write(`\nExported ${rows.length} log(s)\n`);
    }
  });

// ── logs stats ────────────────────────────────────────────
program
  .command("stats")
  .description(
    "Volume overview: count, DB size, timeline, top services, error rate",
  )
  .option("--project <name|id>", "Scope to a project")
  .action(async (opts) => {
    const projectId = await getStore().resolveProjectId(opts.project);
    const rows = await getStore().listLogs({ project_id: projectId, limit: 100000 });
    const total = rows.length;
    const byLevel: Record<string, number> = {};
    const byService: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    let oldest: string | null = null;
    let newest: string | null = null;
    for (const r of rows) {
      byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
      const svc = r.service ?? "-";
      byService[svc] = (byService[svc] ?? 0) + 1;
      if (r.timestamp) {
        if (oldest === null || r.timestamp < oldest) oldest = r.timestamp;
        if (newest === null || r.timestamp > newest) newest = r.timestamp;
        const t = new Date(r.timestamp).getTime();
        if (Number.isFinite(t) && t >= weekAgo) {
          const day = r.timestamp.slice(0, 10);
          byDay[day] = (byDay[day] ?? 0) + 1;
        }
      }
    }
    const errors = byLevel.error ?? 0;
    const fatals = byLevel.fatal ?? 0;
    const errorRate =
      total > 0 ? (((errors + fatals) / total) * 100).toFixed(2) : "0.00";

    console.log(
      `\n${C.bold}Log Volume Stats${C.reset}${opts.project ? ` [${opts.project}]` : ""}`,
    );
    console.log(`  Total:      ${total.toLocaleString()}`);
    console.log(`  Oldest:     ${oldest?.slice(0, 19) ?? "-"}`);
    console.log(`  Newest:     ${newest?.slice(0, 19) ?? "-"}`);
    console.log(
      `  Error rate: ${errorRate}%  (${errors} errors, ${fatals} fatals)`,
    );

    const levels = Object.entries(byLevel).sort((a, b) => b[1] - a[1]);
    if (levels.length) {
      console.log(`\n${C.bold}By Level:${C.reset}`);
      for (const [lvl, c] of levels)
        console.log(`  ${colorLevel(lvl)}  ${c.toLocaleString()}`);
    }

    const services = Object.entries(byService)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (services.length) {
      console.log(`\n${C.bold}Top Services:${C.reset}`);
      for (const [svc, c] of services)
        console.log(
          `  ${C.cyan}${pad(svc, 20)}${C.reset}  ${c.toLocaleString()}`,
        );
    }

    const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
    if (days.length) {
      const maxC = Math.max(...days.map(([, c]) => c));
      console.log(`\n${C.bold}Last 7 Days:${C.reset}`);
      for (const [day, c] of days) {
        const bar = "█".repeat(Math.max(1, Math.round((c / maxC) * 20)));
        console.log(
          `  ${day}  ${C.cyan}${bar}${C.reset}  ${c.toLocaleString()}`,
        );
      }
    }
    console.log("");
  });

// ── logs health ───────────────────────────────────────────
program
  .command("health")
  .description("Show server health and DB stats")
  .action(async () => {
    const h = await getStore().health();
    console.log(JSON.stringify(h, null, 2));
  });

// ── logs transport ────────────────────────────────────────
program
  .command("transport")
  .description(
    "Show which transport and credential source this CLI resolves — never the credential value",
  )
  .option("--json", "Output as JSON")
  .action((opts) => {
    // The report re-runs the @hasna/contracts chain once (fresh, like every
    // data-plane command) and names WHERE things came from: an env key NAME,
    // a Keychain item reference, a credential file PATH, the fleet gateway
    // default, or the explicit local opt-in. Values are never printed.
    const report = resolveLogsTransport();
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`transport: ${report.transport}`);
    console.log(`source: ${report.source}`);
    console.log(`base_url: ${report.base_url ?? "(none)"}`);
    console.log(`api_url_present: ${report.api_url_present}`);
    console.log(`api_url_source: ${report.api_url_source ?? "(none)"}`);
    console.log(`api_key_present: ${report.api_key_present}`);
    console.log(`api_key_source: ${report.api_key_source ?? "(none)"}`);
    console.log(`api_key_tier: ${report.api_key_tier ?? "(none)"}`);
    console.log(`local_opt_in: ${report.local_opt_in}`);
  });

// ── logs mcp / logs serve ─────────────────────────────────
program
  .command("mcp")
  .description("Start the MCP server")
  .option("--claude", "Install into Claude Code")
  .option("--codex", "Install into Codex")
  .option("--gemini", "Install into Gemini")
  .action(async (opts) => {
    if (opts.claude || opts.codex || opts.gemini) {
      const { execSync } = await import("node:child_process");
      // Resolve the MCP binary path — works from both source and dist
      const selfPath = process.argv[1] ?? new URL(import.meta.url).pathname;
      const mcpBin = selfPath.replace(/cli\/index\.(ts|js)$/, "mcp/index.$1");
      const runtime = process.execPath; // bun or node

      if (opts.claude) {
        const cmd = `claude mcp add --transport stdio --scope user logs -- ${runtime} ${mcpBin}`;
        console.log(`Running: ${cmd}`);
        execSync(cmd, { stdio: "inherit" });
        console.log("✓ Installed logs-mcp into Claude Code");
      }
      if (opts.codex) {
        const config = `[mcp_servers.logs]\ncommand = "${runtime}"\nargs = ["${mcpBin}"]`;
        console.log(`Add to ~/.codex/config.toml:\n\n${config}`);
      }
      if (opts.gemini) {
        const config = JSON.stringify(
          { mcpServers: { logs: { command: runtime, args: [mcpBin] } } },
          null,
          2,
        );
        console.log(`Add to ~/.gemini/settings.json mcpServers:\n\n${config}`);
      }
      return;
    }
    await import("../mcp/index.ts");
  });

program
  .command("serve")
  .description(
    "Start the REST API server (PostgreSQL via HASNA_LOGS_DATABASE_URL, or the on-box SQLite collector with HASNA_LOGS_LOCAL=1)",
  )
  .option("--port <n>", "Port", "3460")
  .option(
    "--local-open",
    "Allow trusted local loopback API requests without a token",
  )
  .action(async (opts) => {
    process.env.LOGS_PORT = opts.port;
    if (opts.localOpen) process.env.HASNA_LOGS_LOCAL_OPEN = "1";
    const server = await import("../server/index.ts");
    Bun.serve(server.default);
  });

// ── helpers ───────────────────────────────────────────────
interface WatchCommandOptions {
  server?: string;
  token?: string;
  lastEventId?: string;
  type?: string;
  source?: string;
  project?: string;
  level?: string;
  service?: string;
  trace?: string;
  process?: string;
  run?: string;
  session?: string;
  environment?: string;
  includeRaw?: boolean;
  format?: string;
  once?: boolean;
  interval?: string;
  since?: string;
}

/** Map CLI watch flags to a {@link CliEventWatchFilter} for the local store. */
function toWatchFilter(
  opts: WatchCommandOptions,
  projectId: string | undefined,
): CliEventWatchFilter {
  return {
    event_type: opts.type,
    source: opts.source,
    severity: opts.level,
    project_id: projectId,
    trace_id: opts.trace,
    process_id: opts.process,
    run_id: opts.run,
    session_id: opts.session,
    environment: opts.environment,
    service: opts.service,
  };
}

async function watchEventCatalog(
  store: Store,
  opts: WatchCommandOptions,
  projectId: string | undefined,
): Promise<void> {
  const pollIntervalMs = Math.max(100, Number(opts.interval) || 500);
  const since = parseRelativeTime(opts.since);
  const filter = toWatchFilter(opts, projectId);
  let lastEventId = opts.lastEventId ?? null;
  let errorCount = 0;
  let warnCount = 0;

  if (!opts.once && opts.format !== "json") {
    process.stdout.write("\x1b[2J\x1b[H");
    console.log(
      `${C.bold}@hasna/logs watch events${C.reset} — Ctrl+C to exit${projectId ? `  [project: ${opts.project}]` : ""}\n`,
    );
  }

  const poll = async (): Promise<unknown[]> => {
    const result = await store.watchEvents({
      ...filter,
      since,
      last_event_id: lastEventId ?? undefined,
      limit: 100,
      include_raw: opts.includeRaw === true,
      include_internal: true,
      from_start: since ? true : false,
    });
    if (result.overflow) {
      writeWatchOverflow(result.overflow.reason, result.overflow.last_event_id);
      // The store resets the cursor to the latest event; resume from there so
      // an unknown anchor never replays history.
      if (result.cursor) lastEventId = result.cursor;
    } else if (result.events.length === 0 && result.cursor) {
      // Empty baseline poll (no anchor, not from_start): the store reports the
      // latest cursor and emits nothing. Adopt it so the next poll anchors
      // after it — otherwise every poll repeats the baseline and events
      // ingested after the first poll are never emitted.
      lastEventId = result.cursor;
    }
    const rows = result.events;
    if (opts.once && opts.format === "json") {
      printJson(rows);
      return rows;
    }
    for (const row of rows) {
      lastEventId = row.event_id;
      if (row.severity === "error" || row.severity === "fatal") errorCount += 1;
      if (row.severity === "warn") warnCount += 1;
      if (opts.format === "json") {
        console.log(JSON.stringify(row));
      } else {
        console.log(formatEventWatchRow(row));
      }
    }
    if (opts.format !== "json")
      process.stdout.write(
        `\x1b]2;logs events: ${errorCount}E ${warnCount}W ${lastEventId ?? ""}\x07`,
      );
    return rows;
  };

  await poll();
  if (opts.once) return;

  const interval = setInterval(() => {
    void poll().catch((err) =>
      console.error(
        `[logs watch] poll failed, retrying in ${pollIntervalMs}ms: ${(err as Error).message}`,
      ),
    );
  }, pollIntervalMs);
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log(
      `\n\nErrors: ${errorCount}  Warnings: ${warnCount}  Last event: ${lastEventId ?? "-"}`,
    );
    process.exit(0);
  });
}

async function watchServerEvents(
  opts: WatchCommandOptions,
  projectId: string | undefined,
): Promise<void> {
  let lastEventId = opts.lastEventId ?? null;
  let errorCount = 0;
  let warnCount = 0;
  const token =
    opts.token ||
    process.env.HASNA_LOGS_API_TOKEN ||
    process.env.LOGS_API_TOKEN;

  if (!opts.once && opts.format !== "json") {
    process.stdout.write("\x1b[2J\x1b[H");
    console.log(
      `${C.bold}@hasna/logs watch stream${C.reset} — ${opts.server} — Ctrl+C to exit${projectId ? `  [project: ${opts.project}]` : ""}\n`,
    );
  }

  while (true) {
    const controller = new AbortController();

    try {
      const messages = streamServerEvents({
        url: buildEventStreamUrl(opts, projectId, lastEventId),
        token,
        lastEventId,
        signal: controller.signal,
      });

      for await (const message of messages) {
        if (message.event === "overflow") {
          const overflow = parseJson(message.data) as {
            reason?: string;
            dropped?: number;
            last_event_id?: string | null;
          } | null;
          if (overflow?.last_event_id) lastEventId = overflow.last_event_id;
          const line = `overflow ${overflow?.reason ?? "stream_overflow"} dropped=${overflow?.dropped ?? 0}${overflow?.last_event_id ? ` after ${overflow.last_event_id}` : ""}`;
          opts.format === "json"
            ? console.log(JSON.stringify({ type: "overflow", ...overflow }))
            : console.error(line);
          continue;
        }

        const event = parseJson(message.data) as EventCatalogEntry | null;
        if (!event) continue;
        lastEventId = message.id || event.event_id;
        if (event.severity === "error" || event.severity === "fatal")
          errorCount += 1;
        if (event.severity === "warn") warnCount += 1;
        opts.format === "json"
          ? console.log(JSON.stringify(event))
          : console.log(formatEventWatchRow(event));
        if (opts.format !== "json")
          process.stdout.write(
            `\x1b]2;logs stream: ${errorCount}E ${warnCount}W ${lastEventId}\x07`,
          );
        if (opts.once) return;
      }
    } catch (error) {
      if (opts.once) throw error;
      writeServerWatchOverflow(
        opts,
        "stream_read_error",
        lastEventId,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      controller.abort();
    }

    if (opts.once) return;
    await sleep(1_000);
  }
}

function writeServerWatchOverflow(
  opts: WatchCommandOptions,
  reason: string,
  lastEventId: string | null,
  message: string,
): void {
  if (opts.format === "json") {
    console.log(
      JSON.stringify({
        type: "overflow",
        reason,
        dropped: 0,
        last_event_id: lastEventId,
        message,
      }),
    );
    return;
  }
  console.error(
    `overflow ${reason} dropped=0${lastEventId ? ` after ${lastEventId}` : ""}: ${message}`,
  );
}

function buildEventStreamUrl(
  opts: WatchCommandOptions,
  projectId: string | undefined,
  lastEventId: string | null,
): string {
  if (!opts.server) throw new Error("--server is required");
  const url = new URL(
    "/api/events/stream",
    opts.server.endsWith("/") ? opts.server : `${opts.server}/`,
  );
  url.searchParams.set("event_name", "event");
  addQueryParam(url, "type", opts.type);
  addQueryParam(url, "source", opts.source);
  addQueryParam(url, "severity", opts.level);
  addQueryParam(url, "project_id", projectId);
  addQueryParam(url, "trace_id", opts.trace);
  addQueryParam(url, "process_id", opts.process);
  addQueryParam(url, "run_id", opts.run);
  addQueryParam(url, "session_id", opts.session);
  addQueryParam(url, "environment", opts.environment);
  if (opts.includeRaw) url.searchParams.set("include_raw", "true");
  if (lastEventId) url.searchParams.set("last_event_id", lastEventId);
  return url.toString();
}

function writeWatchOverflow(reason: string, lastEventId: string | null): void {
  process.stderr.write(
    `overflow ${reason}${lastEventId ? ` after ${lastEventId}` : ""}\n`,
  );
}

function addQueryParam(
  url: URL,
  name: string,
  value: string | undefined,
): void {
  if (value) url.searchParams.set(name, value);
}

function formatEventWatchRow(
  row: Pick<
    EventCatalogEntry,
    "event_time" | "event_type" | "severity" | "source" | "event_id" | "message"
  >,
): string {
  const severity = row.severity ?? "-";
  const color = LEVEL_COLOR[severity] ?? "";
  const reset = process.stdout.isTTY ? C.reset : "";
  const bold = process.stdout.isTTY ? C.bold : "";
  const ts = row.event_time.slice(11, 19);
  const type = pad(row.event_type, 10);
  const source = pad(row.source, 8);
  const level = pad(severity.toUpperCase(), 5);
  return `${color}${ts}  ${type}  ${bold}${level}${reset}${color}  ${source}  ${row.message ?? row.event_id}${reset}`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(s: string, n: number) {
  return s.padEnd(n);
}

function parseRelativeTime(val?: string): string | undefined {
  if (!val) return undefined;
  const m = val.match(/^(\d+)(h|d|m)$/);
  if (!m) return val;
  const [, n, unit] = m;
  const ms =
    Number(n) * (unit === "h" ? 3600 : unit === "d" ? 86400 : 60) * 1000;
  return new Date(Date.now() - ms).toISOString();
}

if (!program.commands.some((command) => command.name() === "events")) {
  registerEventsCommands(program, { source: "logs" });
}

// Must be parseAsync (not parse): several actions are async — they route reads
// and writes to the hosted HTTP API. With the synchronous program.parse() the
// bundled binary can exit before an awaited hosted call and its console output
// complete, silently no-opping hosted writes. parseAsync awaits the action to
// completion for both sync and async commands.
//
// A single top-level boundary turns thrown errors (local-only guards, cloud
// HTTP failures, validation) into a clean one-line message + non-zero exit
// instead of an unhandled-rejection stack trace.
try {
  await program.parseAsync();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
