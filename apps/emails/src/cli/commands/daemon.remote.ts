import type { Command } from "commander";
import { handleError } from "../utils.js";
import { createWorkerApi } from "../../lib/worker-supervisor-api.js";
import { runWorkerSupervisor, restartWorker } from "../../lib/worker-supervisor.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function seconds(value: string, max: number) { if (!/^[1-9][0-9]*$/.test(value) || Number(value) > max) throw Error(`Use an integer from 1 to ${max} seconds`); return Number(value) * 1000; }
export function registerDaemonCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  const daemon = program.command("daemon").description("Supervise real foreground API workers");
  daemon.command("status").description("Read worker generations, observed states and lease freshness").action(async () => { try { const result = await createWorkerApi().list(); output(result, result.items.length ? result.items.map(worker => `${worker.id}  ${worker.component}  generation ${worker.generation}  ${worker.state}  ${worker.lease_fresh ? "lease fresh" : "lease expired"}`).join("\n") : "No registered workers. Start one explicitly with emails daemon start."); } catch (error) { handleError(error); } });
  daemon.command("start").description("Own a foreground scheduler and sequence worker; Ctrl-C drains before stopping")
    .option("--worker <uuid>", "Reusable worker UUID for registration retries")
    .option("--interval <seconds>", "Seconds between scheduler batches", "60")
    .option("--once", "Run one batch and stop after confirmed completion")
    .option("--drain-timeout <seconds>", "Bound for reconciling an uncertain in-flight operation", "60")
    .action(async (opts: { worker?: string; interval: string; once?: boolean; drainTimeout: string }) => {
      const id = opts.worker ?? crypto.randomUUID(), stop = new AbortController(); const onStop = () => stop.abort();
      try { if (!uuid.test(id)) throw Error("--worker must be a full UUID"); const intervalMs = seconds(opts.interval, 3600), drainTimeoutMs = seconds(opts.drainTimeout, 3600); process.on("SIGINT", onStop); process.on("SIGTERM", onStop); await runWorkerSupervisor(createWorkerApi(), { id, intervalMs, once: opts.once, drainTimeoutMs }, stop.signal, event => output(event, `Worker ${id}: ${event.phase}, generation ${event.worker.generation}`)); }
      catch (error) { handleError(new Error(`Worker ${id}: ${error instanceof Error ? error.message : "operation unconfirmed"}`)); }
      finally { process.off("SIGINT", onStop); process.off("SIGTERM", onStop); }
    });
  daemon.command("restart").description("Request cooperative drain and confirm the replacement worker generation")
    .option("--worker <uuid>", "Exact worker; optional only for a single-worker registry")
    .option("--idempotency-key <uuid>", "Reusable restart request identity")
    .option("--timeout <seconds>", "How long to wait for confirmed restart", "60")
    .action(async (opts: { worker?: string; idempotencyKey?: string; timeout: string }) => { try { const key = opts.idempotencyKey ?? crypto.randomUUID(); if (!uuid.test(key) || opts.worker && !uuid.test(opts.worker)) throw Error("Worker and restart identities must be full UUIDs"); const result = await restartWorker(createWorkerApi(), opts.worker, key, seconds(opts.timeout, 3600)); output(result, result.restarted ? `Worker ${result.worker_id} restarted: generation ${result.restart.old_generation} -> ${result.restart.new_generation}` : `Restart ${result.request_id} remains ${result.restart.status}; no restart success is claimed.`); if (!result.restarted) process.exitCode = 1; } catch (error) { handleError(error); } });
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
