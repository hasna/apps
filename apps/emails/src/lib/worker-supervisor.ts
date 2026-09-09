import { randomBytes } from "node:crypto";
import { WorkerApiError, type WorkerApi, type WorkerView, type WorkerReceipt } from "./worker-supervisor-api.js";
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const requireWorker = (receipt: WorkerReceipt): WorkerView => { if (!receipt.worker) throw Error("Worker generation receipt is missing"); return receipt.worker; };
export interface SupervisorOptions { id: string; intervalMs: number; once?: boolean; drainTimeoutMs?: number; heartbeatMs?: number; pollMs?: number }
/** Owns one real loop. The token remains memory-only and is never emitted. */
export async function runWorkerSupervisor(api: WorkerApi, options: SupervisorOptions, signal: AbortSignal, observe: (event: { worker: WorkerView; phase: string; result?: Record<string, unknown> | null }) => void = () => { }) {
  const owner_token = randomBytes(32).toString("base64url"); let worker = requireWorker(await api.control(options.id, { action: "register", component: "scheduler", interval_ms: options.intervalMs, owner_token }));
  let finished = false, ticks = 0, failedIteration = false;
  const owner = (action: Parameters<WorkerApi["control"]>[1]["action"]) => ({ action, owner_token, generation: worker.generation });
  async function startGeneration() { try { worker = requireWorker(await api.control(options.id, owner("started"))); } catch (error) { const current = requireWorker(await api.control(options.id, owner("heartbeat"))); if (current.state !== "running") throw error; worker = current; } observe({ worker, phase: "started" }); }
  await startGeneration();
  const heartbeat = (async () => { while (!finished) { await sleep(options.heartbeatMs ?? 5000); if (finished) break; const generation = worker.generation; try { const next = requireWorker(await api.control(options.id, { action: "heartbeat", owner_token, generation })); if (generation === worker.generation) { worker = next; } } catch (error) {/* Foreground refresh retries within the existing lease before any dispatch. */ } } })();
  function owned() { if (Date.now() >= Date.parse(worker.lease_until)) throw Error(`Worker ${options.id} lease expired; no further work was dispatched.`); }
  async function refreshOwnership() {
    while (true) {
      owned();
      try { worker = requireWorker(await api.control(options.id, owner("heartbeat"))); return; }
      catch (error) { if (error instanceof WorkerApiError && [400, 401, 403, 404, 405, 409, 422].includes(error.status)) throw error; await sleep(options.pollMs ?? 500); }
    }
  }
  async function settle(id: string) {
    const deadline = Date.now() + (options.drainTimeoutMs ?? 60000); let receipt: WorkerReceipt | undefined;
    try { receipt = await api.control(options.id, { ...owner("tick"), request_id: id }); } catch {/* Resolve the original operation; never substitute a new id after a timeout. */ }
    while (receipt?.operation?.status !== "complete") {
      if (Date.now() >= deadline) throw Error(`Worker ${options.id} operation ${id} is unconfirmed; it was not marked drained.`);
      await sleep(options.pollMs ?? 500);
      try { receipt = await api.control(options.id, { ...owner("operation"), request_id: id }); }
      catch (error) { if (error instanceof WorkerApiError && error.status === 404) { const current = requireWorker(await api.control(options.id, owner("heartbeat"))); worker = current; if (worker.desired !== "running") return; receipt = await api.control(options.id, { ...owner("tick"), request_id: id }); } }
    }
    const result = receipt.operation.result;
    const countsFailed = (value: unknown) => !!value && typeof value === "object" && ["failed", "pending"].some(key => Number((value as Record<string, unknown>)[key] ?? 0) > 0);
    const failed = !result || result.outcome !== "returned" || typeof result.http_status !== "number" || result.http_status < 200 || result.http_status >= 300 || countsFailed(result.scheduled) || countsFailed(result.sequences);
    failedIteration ||= failed;
    observe({ worker, phase: failed ? "iteration-failed" : "iteration-complete", result });
  }
  try {
    while (true) {
      await refreshOwnership();
      if (worker.desired === "restart") {
        const old = worker.generation;
        try { worker = requireWorker(await api.control(options.id, owner("drain"))); }
        catch (error) { const status = await api.list(); const current = status.items.find(item => item.id === options.id); if (!current || current.generation !== old + 1 || current.state !== "starting") throw error; worker = current; }
        // The old loop has no in-flight call here. Initialize and acknowledge its replacement.
        await startGeneration(); continue;
      }
      if (signal.aborted || options.once && ticks > 0 || worker.desired === "stopped") {
        worker = requireWorker(await api.control(options.id, owner("stop-request")));
        worker = requireWorker(await api.control(options.id, owner("stop"))); observe({ worker, phase: "stopped" }); if (options.once && failedIteration) throw Error("Worker stopped after a failed or pending batch; inspect the iteration receipt and runtime logs."); return worker;
      }
      await settle(crypto.randomUUID()); ticks++;
      if (options.once || signal.aborted) continue;
      const until = Date.now() + options.intervalMs;
      while (Date.now() < until && !signal.aborted && worker.desired === "running") await sleep(Math.min(options.pollMs ?? 250, Math.max(1, until - Date.now())));
    }
  } finally { finished = true; await heartbeat; }
}
export async function restartWorker(api: WorkerApi, id: string | undefined, requestId: string, timeoutMs: number) {
  if (!id) { const list = await api.list(); if (!list.complete || list.items.length !== 1) throw Error("Choose an exact worker with --worker; the registry is empty, ambiguous or incomplete."); id = list.items[0]!.id; }
  let receipt: WorkerReceipt;
  try { receipt = await api.control(id, { action: "restart", request_id: requestId }); }
  catch (error) { throw Error(`Restart request ${requestId} for worker ${id} is unconfirmed. Reuse this request ID to inspect/retry. ${error instanceof Error ? error.message : ""}`); }
  const deadline = Date.now() + timeoutMs;
  try { while (receipt.restart?.status !== "complete" && Date.now() < deadline) { await sleep(Math.min(500, Math.max(1, deadline - Date.now()))); receipt = await api.control(id, { action: "restart-status", request_id: requestId }); } } catch { throw Error(`Restart request ${requestId} for worker ${id} remains unconfirmed; inspect this same request ID.`); }
  if (!receipt.restart) throw Error(`Restart request ${requestId} has no durable receipt.`);
  if (receipt.restart.status === "complete" && (!Number.isSafeInteger(receipt.restart.old_generation) || receipt.restart.old_generation < 1 || receipt.restart.new_generation !== receipt.restart.old_generation + 1)) throw Error(`Restart request ${requestId} has invalid generation evidence; no success is confirmed.`);
  return { worker_id: id, request_id: requestId, restarted: receipt.restart.status === "complete", restart: receipt.restart };
}
