import { existsSync, readFileSync } from "node:fs";
import type { Command } from "commander";
import { getDb } from "../db/client.js";
import { MonitorService, type SlugStatus } from "../service.js";
import type { ControlResult, DefineResult, ErrorResult } from "../service.js";

/**
 * monitor v2 — CLI surface (design §2).
 *
 * Definition and inspection verbs live under `monitor slug ...`;
 * runtime verbs are top-level: `monitor start|stop|restart|status|logs|runs|receipts`.
 * All commands support `--json`. Reads are bounded and cursor-paged.
 */

export function createService(): MonitorService {
  return new MonitorService(getDb());
}

function isErrorResult(
  value: unknown
): value is ErrorResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { accepted?: unknown }).accepted === false &&
    (value as { code?: unknown }).code === "error"
  );
}

function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `invalid duration: ${value} (use e.g. 500ms, 30s, 2m, or bare seconds)`
    );
  }
  const n = Number(match[1]);
  const unit = match[2] ?? "s";
  if (unit === "ms") return Math.max(1, Math.round(n));
  if (unit === "s") return Math.max(1, Math.round(n * 1000));
  return Math.max(1, Math.round(n * 60_000));
}

function parseLimit(value: string | undefined): number {
  if (!value) return 100;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new Error(`invalid limit: ${value} (1..1000)`);
  }
  return n;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readDefinitionFile(path: string): unknown {
  if (!existsSync(path)) {
    fail(`definition file not found: ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`definition file is not valid JSON: ${path} (${(err as Error).message})`);
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printResult(
  result: ErrorResult | ControlResult | DefineResult,
  json: boolean
): void {
  if (isErrorResult(result)) {
    if (json) printJson(result);
    else console.error(`Error: ${result.error}`);
    process.exit(1);
  }
  if (json) {
    printJson(result);
    return;
  }
  const r = result as { code: string; slug: string; state?: string; pending_runs?: number };
  const pending = r.pending_runs !== undefined ? `, pending_runs ${r.pending_runs}` : "";
  console.log(`${r.slug}: ${r.code}${r.state ? ` (state ${r.state}${pending})` : ""}`);
}

export function printSlugStatus(value: SlugStatus | null, json: boolean): void {
  if (!value) {
    fail("slug not found");
  }
  if (json) {
    printJson(value);
    return;
  }
  console.log(`  Slug: ${value.slug}`);
  console.log(`  Desired state: ${value.desired_state}`);
  console.log(`  Active revision: ${value.active_revision ?? "-"}`);
  console.log(`  Next due: ${value.next_due_at ? new Date(value.next_due_at * 1000).toISOString() : "-"}`);
  console.log(`  Queue depth: ${value.queue_depth}`);
  console.log(
    `  Runs: admitted ${value.admitted_count}, leased ${value.leased_count}, ` +
      `running ${value.running_count}, retry_wait ${value.retry_wait_count}, terminal ${value.terminal_count}`
  );
  console.log(`  Expired leases: ${value.expired_lease_count}`);
  console.log(`  Execution epoch: ${value.execution_epoch}`);
  console.log(`  Execution proven: ${value.execution_proven}`);
}

/** Used by the existing `monitor status [machine]` command: when the argument
 * names a defined slug, delegate to the slug status projection. */
export function slugExists(name: string): boolean {
  return createService().describe(name) !== null;
}

export function registerV2Commands(program: Command): void {
  // ── monitor slug ... ─────────────────────────────────────────────────────

  const slugCmd = program
    .command("slug")
    .description("Manage monitor v2 slug definitions and lifecycle");

  slugCmd
    .command("create <slug>")
    .description("Create a slug at revision 1")
    .requiredOption("--file <path>", "path to the slug definition JSON")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { file: string; json?: boolean }) => {
      const definition = readDefinitionFile(opts.file);
      const result = createService().define(slug, definition, { createdBy: "cli" });
      printResult(result, opts.json ?? false);
    });

  slugCmd
    .command("define <slug>")
    .description("Idempotent create-or-update of a slug definition")
    .requiredOption("--file <path>", "path to the slug definition JSON")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { file: string; json?: boolean }) => {
      const definition = readDefinitionFile(opts.file);
      const result = createService().define(slug, definition, { createdBy: "cli" });
      printResult(result, opts.json ?? false);
    });

  slugCmd
    .command("update <slug>")
    .description("Update a slug definition (requires --if-revision)")
    .requiredOption("--file <path>", "path to the slug definition JSON")
    .option("--if-revision <n>", "expected current revision", (v: string) => Number(v))
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { file: string; ifRevision?: number; json?: boolean }) => {
      if (opts.ifRevision === undefined) {
        fail("update requires --if-revision <n> (or use define for idempotent apply)");
      }
      const definition = readDefinitionFile(opts.file);
      const result = createService().define(slug, definition, {
        createdBy: "cli",
        ifRevision: opts.ifRevision,
      });
      printResult(result, opts.json ?? false);
    });

  slugCmd
    .command("validate <target>")
    .description("Validate a definition file or a defined slug")
    .option("-j, --json", "Output raw JSON")
    .action((target: string, opts: { json?: boolean }) => {
      const svc = createService();
      let definition: unknown;
      if (existsSync(target)) {
        definition = readDefinitionFile(target);
      } else {
        const described = svc.describe(target);
        if (!described) {
          fail(`no such definition file or slug: ${target}`);
        }
        definition = described.definition;
      }
      const result = svc.validate(definition);
      if (opts.json) {
        printJson(result);
      } else if (result.valid) {
        console.log("valid");
      } else {
        for (const error of result.errors) console.error(`  invalid: ${error}`);
      }
      if (!result.valid) process.exit(1);
    });

  slugCmd
    .command("describe <slug>")
    .description("Describe a slug's active revision and state")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { json?: boolean }) => {
      const described = createService().describe(slug);
      if (!described) fail(`slug not found: ${slug}`);
      if (opts.json) {
        printJson(described);
        return;
      }
      console.log(`  Slug: ${described.slug}`);
      console.log(`  Revision: ${described.revision}`);
      console.log(`  Desired state: ${described.desired_state}`);
      console.log(`  Execution epoch: ${described.execution_epoch}`);
      console.log(`  Cadence: ${JSON.stringify(described.cadence)}`);
      console.log(`  Checks: ${described.checks.length}`);
    });

  slugCmd
    .command("list")
    .description("List all defined slugs")
    .option("-j, --json", "Output raw JSON")
    .action((opts: { json?: boolean }) => {
      const rows = createService().list().map((row) => ({
        name: row.name,
        description: row.description,
        desired_state: row.desired_state,
        execution_epoch: row.execution_epoch,
        updated_at: row.updated_at,
      }));
      if (opts.json) {
        printJson({ entries: rows });
        return;
      }
      for (const row of rows) {
        console.log(`${row.name}  ${row.desired_state}  ${row.description}`);
      }
    });

  slugCmd
    .command("rollback <slug>")
    .description("Create a new revision equal to a previous immutable revision")
    .requiredOption("--revision <n>", "revision to roll back to", (v: string) => Number(v))
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { revision: number; json?: boolean }) => {
      const result = createService().rollback(slug, opts.revision, { createdBy: "cli" });
      printResult(result, opts.json ?? false);
    });

  slugCmd
    .command("status <slug>")
    .description("Show slug control and execution status")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { json?: boolean }) => {
      printSlugStatus(createService().status(slug), opts.json ?? false);
    });

  // ── monitor start|stop|restart ───────────────────────────────────────────

  program
    .command("start <slug>")
    .description("Start a monitor slug (control-plane operation; never proves execution)")
    .option("--idempotency-key <key>", "replay-safe idempotency key")
    .option("--next-cadence", "admit an immediate run at the current cadence")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { idempotencyKey?: string; nextCadence?: boolean; json?: boolean }) => {
      const result = createService().start(slug, {
        idempotencyKey: opts.idempotencyKey,
        nextCadence: opts.nextCadence,
      });
      printResult(result, opts.json ?? false);
    });

  program
    .command("stop <slug>")
    .description("Stop a monitor slug (graceful drain by default; --cancel is explicit)")
    .option("--cancel", "cancel queued work and revoke active leases")
    .option("--wait", "wait for a terminal drain observation")
    .option("--timeout <duration>", "finite wait bound (e.g. 500ms, 30s, 2m; default 30s)")
    .option("--idempotency-key <key>", "replay-safe idempotency key")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { cancel?: boolean; wait?: boolean; timeout?: string; idempotencyKey?: string; json?: boolean }) => {
      let timeoutMs: number | undefined;
      if (opts.timeout) {
        try {
          timeoutMs = parseDuration(opts.timeout);
        } catch (err) {
          fail((err as Error).message);
        }
      }
      const result = createService().stop(slug, {
        cancel: opts.cancel,
        wait: opts.wait,
        timeoutMs,
        idempotencyKey: opts.idempotencyKey,
      });
      printResult(result, opts.json ?? false);
    });

  program
    .command("restart <slug>")
    .description("Restart a monitor slug (resumes the same slug identity and revision lineage)")
    .option("--cancel", "cancel queued work before starting a new execution epoch")
    .option("--wait", "wait for a terminal drain observation")
    .option("--timeout <duration>", "finite wait bound (e.g. 500ms, 30s, 2m; default 30s)")
    .option("--idempotency-key <key>", "replay-safe idempotency key")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { cancel?: boolean; wait?: boolean; timeout?: string; idempotencyKey?: string; json?: boolean }) => {
      let timeoutMs: number | undefined;
      if (opts.timeout) {
        try {
          timeoutMs = parseDuration(opts.timeout);
        } catch (err) {
          fail((err as Error).message);
        }
      }
      const result = createService().restart(slug, {
        cancel: opts.cancel,
        wait: opts.wait,
        timeoutMs,
        idempotencyKey: opts.idempotencyKey,
      });
      printResult(result, opts.json ?? false);
    });

  // ── monitor logs|runs|receipts ───────────────────────────────────────────

  program
    .command("logs <slug>")
    .description("List run/attempt log projections for a slug")
    .option("--run <run-id>", "filter to one run")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { run?: string; json?: boolean }) => {
      const entries = createService().logs(slug, { runId: opts.run });
      if (opts.json) {
        printJson({ slug, entries });
        return;
      }
      for (const entry of entries) {
        console.log(
          `${entry.run_id}  ${entry.run_state}  attempt ${entry.attempt_number ?? "-"} ` +
            `${entry.attempt_state ?? ""} ${entry.outcome ?? ""}`
        );
      }
    });

  program
    .command("runs <slug>")
    .description("List runs for a slug (bounded, cursor-paged)")
    .option("--state <state>", "filter by run state")
    .option("--cursor <cursor>", "paging cursor from a previous response")
    .option("--limit <n>", "page size (1..1000, default 100)")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { state?: string; cursor?: string; limit?: string; json?: boolean }) => {
      let limit = 100;
      try {
        limit = parseLimit(opts.limit);
      } catch (err) {
        fail((err as Error).message);
      }
      const result = createService().runs(slug, {
        state: opts.state,
        cursor: opts.cursor,
        limit,
      });
      if (opts.json) {
        printJson({ slug, ...result });
        return;
      }
      for (const row of result.entries) {
        console.log(`${row.id}  ${row.state}  ${row.outcome ?? ""}`);
      }
      if (result.has_more) console.error(`  (more — cursor ${result.next_cursor})`);
    });

  program
    .command("receipts <slug>")
    .description("List terminal receipts for a slug (bounded, cursor-paged)")
    .option("--run <run-id>", "filter to one run")
    .option("--cursor <cursor>", "paging cursor from a previous response")
    .option("--limit <n>", "page size (1..1000, default 100)")
    .option("-j, --json", "Output raw JSON")
    .action((slug: string, opts: { run?: string; cursor?: string; limit?: string; json?: boolean }) => {
      let limit = 100;
      try {
        limit = parseLimit(opts.limit);
      } catch (err) {
        fail((err as Error).message);
      }
      const result = createService().receipts(slug, {
        runId: opts.run,
        cursor: opts.cursor,
        limit,
      });
      if (opts.json) {
        printJson({ slug, ...result });
        return;
      }
      for (const row of result.entries) {
        console.log(`${row.id}  ${row.state}  ${row.reason}`);
      }
      if (result.has_more) console.error(`  (more — cursor ${result.next_cursor})`);
    });
}
