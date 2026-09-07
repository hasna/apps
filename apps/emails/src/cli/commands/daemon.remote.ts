import type { Command } from "commander";
import chalk from "../../lib/chalk-lite.js";
import { renderStatusCount, renderStatusUnavailable } from "../../lib/status-availability.js";
import { handleError } from "../utils.js";

/**
 * The provisioning queue, taken from the SAME status facts `emails status` reports.
 *
 * This used to call `getProvisioningWorkSummary()` through the deleted HTTP arm of the
 * provisioning family, which was a single `list({ limit: 1000 })` against `/v1/domains`
 * and `/v1/addresses` — not `/v1/provisioning`, which holds only the audit trail. The
 * server clamps every list to 500 rows, so those four counts were computed over at
 * most the first 500 rows of each resource and printed as bare integers: 600 due
 * domains rendered as `Due work: 500 domain(s)`. That family has since collapsed onto
 * the store seam and `getProvisioningWorkSummary` now carries a `StatusAvailability`
 * of its own, so the local sibling renders the same way this one does; the fields here
 * still measure something different, which is why they keep their own names.
 *
 * The honest answer was already in hand and thrown away.
 * `getEmailSystemStatusForRuntime()` is awaited here anyway, and its `provisioning`
 * block is built by `enumerateSelfHostedRows` and carries
 * `availability.complete === false` with the reason "counts are lower bounds, not
 * totals" whenever it cannot walk the table.
 *
 * Two consequences, both deliberate:
 *  - the counts render through `renderStatusCount`, so an incomplete read prints
 *    `≥N` exactly as `emails status` does, and `availability` is carried in the JSON
 *    so `scanStatusAvailability` can see it;
 *  - the fields are named for what they MEASURE. `pending` is not `due`: a
 *    schedule-aware "due now" count needs `next_check_at <= now` over the WHOLE
 *    table, which this client cannot establish completely over `/v1`. Reporting
 *    pending under the old `due_*` keys would have kept the label and quietly
 *    changed the question.
 */
async function daemonStatus() {
  const { getEmailSystemStatusForRuntime } = await import("../../lib/agent-context.js");
  const now = new Date().toISOString();
  const system = await getEmailSystemStatusForRuntime();
  return {
    generated_at: now,
    queue: {
      availability: system.provisioning.availability,
      domains_pending: system.provisioning.domains_pending,
      domains_failed: system.provisioning.domains_failed,
      addresses_pending: system.provisioning.addresses_pending,
      addresses_failed: system.provisioning.addresses_failed,
      // A schedule-aware "due now" count is NOT derivable here; see the note above.
      due_derivable: false,
      drainable: false,
    },
    realtime: system.inbox.realtime,
    // Watch is a foreground API polling client, not evidence of a running daemon.
    start_commands: { inbound: "emails inbox watch --source <source-id>" },
    start_requirements: "Requires an operator credential and a registered API server ingest binding with a dedicated queue.",
  };
}

function formatDaemonStatus(status: Awaited<ReturnType<typeof daemonStatus>>): string {
  const lines = [chalk.bold("\nDaemon status:")];
  const queue = status.queue;
  if (!queue.availability.available) {
    lines.push(`  Provisioning: ${renderStatusUnavailable(queue.availability)}`);
  } else {
    const count = (value: number | null) => renderStatusCount(value, queue.availability);
    lines.push(`  Pending:    ${count(queue.domains_pending)} domain(s), ${count(queue.addresses_pending)} address(es)`);
    lines.push(`  Failed:     ${count(queue.domains_failed)} domain(s), ${count(queue.addresses_failed)} address(es)`);
    if (queue.availability.complete === false) {
      lines.push(chalk.yellow(`  Counts are LOWER BOUNDS: ${queue.availability.reason ?? "the enumeration could not be completed"}`));
    }
  }
  // Status facts do not poll SQS or prove that a watcher process is running.
  // Preserve their availability instead of inferring a worker heartbeat.
  lines.push(`  Realtime:   ${renderStatusUnavailable(status.realtime.availability)}`);
  lines.push("");
  lines.push(chalk.dim("  No schedule-aware 'due now' count is derivable over /v1; pending/failed are shown instead."));
  lines.push(chalk.dim("  No provisioning reconciler ships in this build; the queue above is not drained automatically."));
  lines.push(chalk.dim(`  Foreground inbox polling: ${status.start_commands.inbound}`));
  lines.push(chalk.dim(`  ${status.start_requirements}`));
  lines.push(chalk.dim("  Watch polls the API; this status does not establish a separate worker heartbeat."));
  return lines.join("\n");
}

export function registerDaemonCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  const daemon = program.command("daemon").description("Inspect email daemon and background worker health");

  daemon
    .command("status")
    .description("Show provisioning/realtime daemon queue status")
    .action(async () => {
      try {
        const status = await daemonStatus();
        output(status, formatDaemonStatus(status));
      } catch (e) {
        handleError(e);
      }
    });

  daemon
    .command("restart")
    .description("Show restart guidance for configured email background workers")
    .action(() => {
      try {
        // Every field below is a constant. This used to `await daemonStatus()` first,
        // which cost four `/v1` enumerations and turned a fixed answer into one that
        // failed with a transport error whenever the service was unreachable — the
        // question "is a supervisor configured in THIS process?" does not depend on
        // the server being up.
        const result = {
          managed_process: false,
          reason: "No built-in supervisor or PID file is configured for this package; no process was restarted.",
          start_commands: { inbound: "emails inbox watch --source <source-id>" },
          start_requirements: "Requires an operator credential and a registered API server ingest binding with a dedicated queue.",
          cli_equivalent: "emails daemon status --json",
        };
        output(result, chalk.yellow("No managed email daemon process is configured in this client."));
      } catch (e) {
        handleError(e);
      }
    });

  const logs = program.command("logs").description("Inspect tenant API worker lifecycle logs");
  logs.command("tail")
    .description("Read persisted API operation logs; not container stdout or a worker heartbeat")
    .option("--component <name>", "daemon | sync | inbound | scheduler | nightly", "daemon")
    .option("--lines <n>", "Newest log records to show (1-500)", "80")
    .action(async (opts: { component: string; lines: string }) => {
      try {
        const { tailApiRuntimeLogs } = await import("../../lib/runtime-log-api.js");
        const result = await tailApiRuntimeLogs(opts.component, opts.lines);
        const formatted = result.items.length
          ? result.items.map(item => `${item.created_at}  ${item.operation}  ${item.event}${item.http_status === null ? "" : ` HTTP ${item.http_status}`}  ${item.request_id}`).join("\n")
          : `No recorded ${result.component} API worker events. Older activity and uninstrumented workers are not reconstructed; this is not evidence that a worker is stopped.`;
        output(result, `${formatted}\nAPI operation logs only; container stdout and worker liveness are not measured.`);
      } catch (error) { handleError(error); }
    });
}
