import { expect, test } from "bun:test";
import { runWorkerSupervisor, restartWorker } from "./worker-supervisor.js";
import { WorkerApiError, type WorkerApi, type WorkerView } from "./worker-supervisor-api.js";
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function view(): WorkerView { return { id: crypto.randomUUID(), component: "scheduler", generation: 1, state: "starting", desired: "running", lease_until: new Date(Date.now() + 60000).toISOString(), heartbeat_at: new Date().toISOString(), lease_fresh: true, restart_id: null, interval_ms: 1000 }; }
test("foreground supervisor heartbeats during unknown HTTP work, drains only server-completed operation and starts new generation", async () => {
  let worker = view(), heartbeats = 0, polls = 0, active = false; const actions: string[] = [], events: unknown[] = []; let operationId = "";
  const api: WorkerApi = {
list: async () => ({ items: [{ ...worker }], complete: true }), control: async (_id, body) => {
actions.push(body.action); switch (body.action) {
        case "register": return { worker: { ...worker } };
        case "started": worker = { ...worker, state: "running" }; return { worker: { ...worker } };
        case "heartbeat": heartbeats++; return { worker: { ...worker } };
        case "tick": active = true; operationId = body.request_id!; await pause(25); worker = { ...worker, state: "draining", desired: "restart" }; throw new WorkerApiError(0);
        case "operation": expect(body.request_id).toBe(operationId); if (++polls < 3) return { operation: { id: operationId, status: "running", generation: 1, result: null } }; active = false; return { operation: { id: operationId, status: "complete", generation: 1, result: { outcome: "returned", http_status: 200 } } };
        case "drain": expect(active).toBe(false); expect(heartbeats).toBeGreaterThan(2); worker = { ...worker, generation: 2, state: "starting", desired: "running" }; return { worker: { ...worker } };
        case "stop-request": expect(active).toBe(false); worker = { ...worker, state: "draining", desired: "stopped" }; return { worker: { ...worker } };
        case "stop": worker = { ...worker, state: "stopped" }; return { worker: { ...worker } };
        default: throw Error("unexpected operation");
      }
}
};
  const stopped = await runWorkerSupervisor(api, { id: worker.id, intervalMs: 1, heartbeatMs: 5, pollMs: 5, once: true, drainTimeoutMs: 1000 }, new AbortController().signal, event => events.push(event));
  expect(stopped).toMatchObject({ generation: 2, state: "stopped" }); expect(actions.filter(x => x === "tick")).toHaveLength(1); expect(actions.filter(x => x === "started")).toHaveLength(2); expect(JSON.stringify(events)).not.toContain("owner_token");
});
test("unconfirmed in-flight operation never drains or starts a replacement", async () => {
  const worker = view(), actions: string[] = []; const api: WorkerApi = { list: async () => ({ items: [worker], complete: true }), control: async (_id, body) => { actions.push(body.action); if (body.action === "tick") throw new WorkerApiError(0); if (body.action === "operation") return { operation: { id: body.request_id!, status: "running", generation: 1, result: null } }; return { worker: { ...worker, state: "running", desired: "restart" } }; } };
  // Do not advertise restart before the first dispatch; trigger it only once tick has begun.
  const control = api.control; api.control = async (id, body) => { const r = await control(id, body); if (r.worker && !actions.includes("tick")) r.worker.desired = "running"; return r; };
  await expect(runWorkerSupervisor(api, { id: worker.id, intervalMs: 1, heartbeatMs: 5, pollMs: 5, drainTimeoutMs: 35 }, new AbortController().signal)).rejects.toThrow("not marked drained"); expect(actions).not.toContain("drain"); expect(actions).not.toContain("stop");
});
test("restart confirmation requires generation evidence and ambiguous registries do not choose a worker", async () => {
  const a = view(), b = view(); let calls = 0; const api: WorkerApi = { list: async () => ({ items: [a, b], complete: true }), control: async () => { calls++; return { restart: { id: crypto.randomUUID(), worker_id: a.id, status: "complete", old_generation: 1, new_generation: 1 } }; } };
  await expect(restartWorker(api, undefined, crypto.randomUUID(), 1)).rejects.toThrow("exact worker"); expect(calls).toBe(0); await expect(restartWorker(api, a.id, crypto.randomUUID(), 1)).rejects.toThrow("generation evidence");
});
test("completed failed batches are reported and --once fails only after safe stop", async () => {
  for (const result of [{ outcome: "threw" }, { outcome: "returned", http_status: 200, scheduled: { failed: 1 } }, { outcome: "returned", http_status: 200, sequences: { pending: 1 } }]) {
    let worker = view(); const actions: string[] = [], events: Array<{ phase: string }> = [];
    const api: WorkerApi = { list: async () => ({ items: [worker], complete: true }), control: async (_id, body) => { actions.push(body.action); if (body.action === "tick") return { operation: { id: body.request_id!, status: "complete", generation: 1, result } }; if (body.action === "started") worker = { ...worker, state: "running" }; if (body.action === "stop-request") worker = { ...worker, state: "draining", desired: "stopped" }; if (body.action === "stop") worker = { ...worker, state: "stopped" }; return { worker: { ...worker } }; } };
    await expect(runWorkerSupervisor(api, { id: worker.id, intervalMs: 60000, once: true, heartbeatMs: 5, pollMs: 5 }, new AbortController().signal, event => events.push(event))).rejects.toThrow("failed or pending batch");
    expect(actions.at(-1)).toBe("stop"); expect(events.map(event => event.phase)).toContain("iteration-failed"); expect(events.at(-1)?.phase).toBe("stopped");
  }
});
test("transient heartbeat failures reconcile before dispatch while the old lease remains valid", async () => {
  let worker = view(), heartbeats = 0, ticks = 0; const api: WorkerApi = {
list: async () => ({ items: [worker], complete: true }), control: async (_id, body) => {
      if (body.action === "heartbeat" && ++heartbeats === 1) throw new WorkerApiError(0);
      if (body.action === "tick") { expect(heartbeats).toBeGreaterThanOrEqual(2); ticks++; return { operation: { id: body.request_id!, status: "complete", generation: 1, result: { outcome: "returned", http_status: 200 } } }; }
      if (body.action === "started") worker = { ...worker, state: "running" }; if (body.action === "stop-request") worker = { ...worker, state: "draining", desired: "stopped" }; if (body.action === "stop") worker = { ...worker, state: "stopped" }; return { worker: { ...worker } };
    }
};
  expect((await runWorkerSupervisor(api, { id: worker.id, intervalMs: 60000, once: true, heartbeatMs: 5, pollMs: 5 }, new AbortController().signal)).state).toBe("stopped"); expect(ticks).toBe(1);
});
