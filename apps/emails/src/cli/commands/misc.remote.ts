import type { Command } from "commander";
import chalk from "../../lib/chalk-lite.js";
import { cancelScheduledEmail, listScheduledEmailSummaries } from "../../db/scheduled.js";
import { truncate } from "../../lib/format.js";
import {
  formatListHint,
  handleError,
  isCliVerboseOutput,
  parseCliListPage,
  resolveId,
  parseScheduledStatusFilter,
  parseDuration,
} from "../utils.js";

export interface SchedulerTickResult {
  scheduled: { attempted: number; sent: number; failed: number; skipped: number; pending?: number };
  sequences: { attempted: number; sent: number; failed: number; skipped: number };
}

interface SchedulerTickOptions {
  scheduledLimit?: number;
  sequenceLimit?: number;
  log?: (message: string) => void;
}

interface ScheduleListOptions {
  status?: string;
  limit?: string;
  offset?: string;
  verbose?: boolean;
}

// Scheduler execution and ingestion diagnostics still need service operations.
// Batch sends compose API requests; schedule listing/cancellation use the
// existing /v1/scheduled resource.
export async function runSchedulerTick(opts: SchedulerTickOptions = {}): Promise<SchedulerTickResult> {
  if (opts.sequenceLimit !== undefined) throw new Error("Sequence execution requires its own job runner; this endpoint runs scheduled messages");
  const { selfHostedApiRequest } = await import("../../db/self-hosted-store.js");
  const response = selfHostedApiRequest("POST", "/scheduled/run", { limit: opts.scheduledLimit ?? 10 });
  if (response.status < 200 || response.status >= 300) {
    const error = response.json as { error?: string };
    throw new Error(error.error ?? `Scheduler request failed (HTTP ${response.status})`);
  }
  const result = response.json as { scheduled?: SchedulerTickResult["scheduled"] & { pending?: number }; items?: unknown[]; sequence_execution?: string };
  if (!result.scheduled || !Number.isSafeInteger(result.scheduled.attempted) || !Number.isSafeInteger(result.scheduled.sent) || !Number.isSafeInteger(result.scheduled.failed)) throw new Error("Scheduler API returned invalid counts");
  opts.log?.(`${result.scheduled.sent} scheduled sends completed; ${result.scheduled.failed} failed; ${result.scheduled.pending ?? 0} pending`);
  return { ...result, scheduled: result.scheduled, sequences: { attempted: 0, sent: 0, failed: 0, skipped: 0 } };
}

async function runSchedulerCommand(opts: { interval?: string; once?: boolean; limit?: string }, output: (data: unknown, formatted: string) => void): Promise<void> {
  const interval = parseDuration(opts.interval ?? "30s");
  if (!Number.isFinite(interval) || interval < 1000) throw new Error("Scheduler interval must be at least one second");
  const limit = Number(opts.limit ?? "10");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Scheduler limit must be 1–100");
  do {
    const result = await runSchedulerTick({ scheduledLimit: limit });
    output(result, `Scheduled sends: ${result.scheduled.sent} sent, ${result.scheduled.failed} failed, ${result.scheduled.pending ?? 0} processing of ${result.scheduled.attempted} attempted. Sequence execution is not included.`);
    if (opts.once) { if (result.scheduled.failed || result.scheduled.pending) process.exitCode = 1; return; }
    await new Promise(resolve => setTimeout(resolve, interval));
  } while (true);
}

function scheduledStatusOf(opts: ScheduleListOptions) {
  return parseScheduledStatusFilter(opts.status);
}

function colorScheduledStatus(status: string): string {
  if (status === "pending") return chalk.blue(status);
  if (status === "sent") return chalk.green(status);
  if (status === "cancelled") return chalk.yellow(status);
  return chalk.red(status);
}

async function cancelScheduled(id: string, describe: (shortId: string) => string): Promise<void> {
  const resolvedId = resolveId("scheduled_emails", id);
  if (!(await cancelScheduledEmail(resolvedId))) {
    handleError(new Error(`Cannot cancel email ${id} (may already be sent or cancelled)`));
  }
  console.log(chalk.green(describe(resolvedId.slice(0, 8))));
}

export function registerMiscCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  // ─── SCHEDULE ───────────────────────────────────────────────────────────────
  // Unified `schedule` command. Old `scheduled` kept as alias.
  const scheduleCmd = program.command("schedule").description("Manage and run the email scheduler");
  // Keep `scheduled` as alias
  const scheduledCmd = program.command("scheduled").description("Manage scheduled emails (alias: emails schedule)");

  scheduledCmd
    .command("list")
    .description("List scheduled emails")
    .option("--status <status>", "Filter by status: pending|processing|sent|cancelled|failed")
    .option("--limit <n>", "Maximum scheduled emails to show (default 20 compact, 50 verbose/json)")
    .option("--offset <n>", "Number of scheduled emails to skip", "0")
    .option("--verbose", "Show expanded list hints")
    .action(async (opts: ScheduleListOptions) => {
      try {
        const status = scheduledStatusOf(opts);
        const page = parseCliListPage(opts);
        // Reads the store seam (async). A schedule it could not enumerate to the end is a
        // THROW landing on `handleError`, never a short page presented as the whole list.
        const emails = await listScheduledEmailSummaries({
          ...(status ? { status } : {}),
          ...page,
        });
        if (emails.length === 0) {
          output([], chalk.dim("No scheduled emails."));
          return;
        }
        const lines = [chalk.bold("\nScheduled Emails:")];
        for (const e of emails) {
          lines.push(`  ${chalk.cyan(e.id.slice(0, 8))}  ${truncate(e.subject, 40)}  -> ${truncate(e.to_addresses.join(", "), 42)}  [${colorScheduledStatus(e.status)}]  at ${e.scheduled_at}`);
        }
        lines.push("");
        lines.push(formatListHint({
          shown: emails.length,
          limit: page.limit,
          offset: page.offset,
          noun: "scheduled email",
          detailCommand: "filter with --status or adjust --limit/--offset",
          verbose: opts.verbose || isCliVerboseOutput(),
        }));
        output(emails, lines.join("\n"));
      } catch (e) {
        handleError(e);
      }
    });

  scheduledCmd
    .command("cancel <id>")
    .description("Cancel a scheduled email")
    .action(async (id: string) => {
      try {
        // Awaited so a refusal from the store reaches `handleError` instead of surfacing as
        // an unhandled rejection after the command has already reported success.
        await cancelScheduled(id, (shortId) => `✓ Scheduled email cancelled: ${shortId}`);
      } catch (e) {
        handleError(e);
      }
    });

  // schedule list / cancel — same as scheduled but under unified command
  scheduleCmd
    .command("list")
    .description("List scheduled emails")
    .option("--status <status>", "Filter: pending|processing|sent|cancelled|failed")
    .option("--limit <n>", "Maximum scheduled emails to show (default 20 compact, 50 verbose/json)")
    .option("--offset <n>", "Number of scheduled emails to skip", "0")
    .option("--verbose", "Show expanded list hints")
    .action(async (opts: ScheduleListOptions) => {
      try {
        const status = scheduledStatusOf(opts);
        const page = parseCliListPage(opts);
        // Reads the store seam (async). A schedule it could not enumerate to the end is a
        // THROW landing on `handleError`, never a short page presented as the whole list.
        const emails = await listScheduledEmailSummaries({
          ...(status ? { status } : {}),
          ...page,
        });
        if (emails.length === 0) { output([], chalk.dim("No scheduled emails.")); return; }
        const lines = [chalk.bold("\nScheduled:")];
        for (const e of emails) {
          lines.push(`  ${chalk.cyan(e.id.slice(0, 8))}  ${e.scheduled_at}  [${colorScheduledStatus(e.status)}]  ${truncate(e.subject, 40)}  -> ${truncate(e.to_addresses.join(", "), 42)}`);
        }
        lines.push("");
        lines.push(formatListHint({
          shown: emails.length,
          limit: page.limit,
          offset: page.offset,
          noun: "scheduled email",
          detailCommand: "filter with --status or adjust --limit/--offset",
          verbose: opts.verbose || isCliVerboseOutput(),
        }));
        output(emails, lines.join("\n"));
      } catch (e) { handleError(e); }
    });

  scheduleCmd
    .command("cancel <id>")
    .description("Cancel a scheduled email")
    .action(async (id: string) => {
      try {
        // Awaited so a refusal from the store reaches `handleError` instead of surfacing as
        // an unhandled rejection after the command has already reported success.
        await cancelScheduled(id, (shortId) => `✓ Cancelled: ${shortId}`);
      } catch (e) { handleError(e); }
    });

  scheduleCmd
    .command("run")
    .description("Start the scheduler daemon — sends due emails on interval")
    .option("--interval <duration>", "Poll interval (e.g. 30s, 1m)", "30s")
    .option("--once", "Process one due batch and exit")
    .option("--limit <count>", "Maximum due jobs per batch (1–100)", "10")
    .action(async (opts: { interval?: string; once?: boolean; limit?: string }) => {
      try { await runSchedulerCommand(opts, output); } catch (e) { handleError(e); }
    });

  // ─── SCHEDULER (alias) ───────────────────────────────────────────────────────
  program
    .command("scheduler")
    .description("Start the email scheduler (alias: emails schedule run)")
    .option("--interval <duration>", "Poll interval (e.g. 30s, 1m, 5m)", "30s")
    .option("--once", "Process one due batch and exit")
    .option("--limit <count>", "Maximum due jobs per batch (1–100)", "10")
    .action(async (opts: { interval?: string; once?: boolean; limit?: string }) => {
      try { await runSchedulerCommand(opts, output); } catch (e) { handleError(e); }
    });

  // ─── BATCH ──────────────────────────────────────────────────────────────────
  program
    .command("batch")
    .description("Batch send emails from CSV")
    .requiredOption("--csv <path>", "Path to CSV file (must have 'email' column)")
    .requiredOption("--template <name>", "Template name to use")
    .requiredOption("--from <email>", "Sender email address")
    .option("--provider <id>", "Provider ID (uses first active if not specified)")
    .option("--force", "Send even to suppressed contacts (requires server authority)")
    .option("--idempotency-key <key>", "Batch retry identity; defaults to rendered content hash. Use a new key to intentionally resend")
    .action(async (opts: import("./api-send-composition.js").ApiBatchOptions) => {
      try {
        const { sendApiBatch } = await import("./api-send-composition.js");
        const result = await sendApiBatch(opts);
        output(result, `Batch ${result.batch_id}: ${result.sent} sent, ${result.pending} processing, ${result.failed} failed of ${result.total}\n${result.errors.map(error => `${error.email}: ${error.error}`).join("\n")}`);
        if (result.failed || result.pending) process.exitCode = 1;
      } catch (e) { handleError(e); }
    });

  // ─── COMPLETION ───────────────────────────────────────────────────────────────
  program
    .command("completion")
    .description("Generate shell completion script")
    .argument("<shell>", "Shell type: bash, zsh, or fish")
    .action(async (shell: string) => {
      const { generateBashCompletion, generateZshCompletion, generateFishCompletion } = await import("../../lib/completion.js");
      switch (shell) {
        case "bash":
          console.log(generateBashCompletion());
          break;
        case "zsh":
          console.log(generateZshCompletion());
          break;
        case "fish":
          console.log(generateFishCompletion());
          break;
        default:
          handleError(new Error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`));
      }
    });

  // ─── DOCTOR ───────────────────────────────────────────────────────────────────
  // src/lib/doctor.ts is now ONE implementation for both command sets: it reads its
  // resource facts through the store seam, so reachability comes from a SERVED READ
  // rather than from a configuration that parsed. Same implementation the MCP
  // `run_doctor` tool runs, and the same one src/cli/commands/misc.local.ts imports.
  //
  // It no longer probes `/health` and `/ready` — the seam has no readiness operation
  // and reaching those endpoints would need the deployment-mode module the seam exists
  // to remove. The report says so in a `Store readiness` check rather than dropping the
  // subject, so the description below no longer claims the probe either.
  //
  // `--live` stays UNREGISTERED here. The reason it was left off this arm has widened
  // rather than gone: it means "validate the stored per-provider credentials against the
  // provider's API", and the store seam redacts credential columns in BOTH stores, so
  // nothing behind either command set can honour it now. `emails provider status` does.
  const doctorCmd = program
    .command("doctor")
    .description("Run system diagnostics (reads through the configured store). Always exits 0 — the report is the product; gate automation on the --json check statuses, not the exit code")
    .action(async () => {
      try {
        const { runDiagnostics, formatDiagnostics } = await import("../../lib/doctor.js");
        const checks = await runDiagnostics();
        output(checks, formatDiagnostics(checks));
      } catch (e) {
        handleError(e);
      }
    });

  doctorCmd
    .command("delivery <address>")
    .description("Diagnose inbound delivery using the API registry and received-mail evidence")
    .option("--live", "Also inspect public MX records")
    .action(async (address: string, opts: { live?: boolean }) => {
      try {
        const { apiDeliveryDiagnosis } = await import("./api-diagnostics.js");
        const { formatDeliveryDoctorReport } = await import("../../lib/delivery-doctor.js");
        const report = await apiDeliveryDiagnosis(address, opts);
        output(report, formatDeliveryDoctorReport(report));
      } catch (e) { handleError(e); }
    });

  // ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────
  program
    .command("verify-email <email>")
    .description("Verify an email address (format + MX records + optional SMTP probe)")
    .option("--smtp", "Also do SMTP probe (RCPT TO check, no email sent)")
    .option("--timeout <ms>", "DNS/SMTP timeout in milliseconds", "5000")
    .action(async (email: string, opts: { smtp?: boolean; timeout?: string }) => {
      try {
        const { verifyEmailAddress, formatVerifyResult } = await import("../../lib/email-verify.js");
        const result = await verifyEmailAddress(email, {
          smtpProbe: !!opts.smtp,
          timeoutMs: parseInt(opts.timeout ?? "5000", 10),
        });
        const formatted = formatVerifyResult(result);
        output(result, result.valid ? chalk.green(formatted) : chalk.red(formatted));
      } catch (e) {
        handleError(e);
      }
    });
}
