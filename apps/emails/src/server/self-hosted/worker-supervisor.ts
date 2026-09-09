import { createHash } from "node:crypto";
import type { PoolQueryClient, TypedQueryClient } from "../../storage-kit/index.js";
export interface WorkerFence { id: string; generation: number; ownerHash: string }
export class WorkerError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function workerId(value: unknown): string { if (typeof value !== "string" || !uuid.test(value)) throw new WorkerError("A full worker/request UUID is required", 400); return value.toLowerCase(); }
export function workerFence(id: string, body: Record<string, unknown>): WorkerFence {
  if (typeof body.owner_token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.owner_token) || !Number.isSafeInteger(body.generation) || Number(body.generation) < 1) throw new WorkerError("A valid owner token and generation are required", 400);
  return { id: workerId(id), generation: Number(body.generation), ownerHash: createHash("sha256").update(body.owner_token).digest("hex") };
}
export const WORKER_CLAIM_CTE = `WITH worker_guard AS MATERIALIZED (SELECT id FROM runtime_workers WHERE tenant_id=$1 AND id=$3 AND generation=$4 AND owner_hash=$5 AND state='running' AND desired='running' AND lease_until>clock_timestamp() FOR SHARE),`;
interface WorkerRow extends Record<string, unknown> { id: string; component: string; generation: number; owner_hash: string; state: string; desired: string; lease_until: Date | string; heartbeat_at: Date | string; restart_id: string | null; interval_ms: number; lease_fresh?: boolean }
function publicWorker(row: WorkerRow) { return { id: row.id, component: row.component, generation: row.generation, state: row.state, desired: row.desired, lease_until: new Date(row.lease_until).toISOString(), heartbeat_at: new Date(row.heartbeat_at).toISOString(), lease_fresh: row.lease_fresh ?? new Date(row.lease_until).getTime() > Date.now(), restart_id: row.restart_id, interval_ms: row.interval_ms }; }
export class WorkerSupervisorStore {
  constructor(private pool: PoolQueryClient, private tenant: string) { }
  private async tx<T>(work: (tx: TypedQueryClient) => Promise<T>): Promise<T> {
    return this.pool.transaction(async tx => { await tx.execute("SELECT set_config('app.current_tenant',$1,true)", [this.tenant]); await tx.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'"); if (!await tx.get("SELECT id FROM tenants WHERE id=$1 AND status='active' FOR SHARE", [this.tenant])) throw new WorkerError("Tenant is not active", 403); return work(tx); });
  }
  private async owned(tx: TypedQueryClient, fence: WorkerFence) {
    const row = await tx.get<WorkerRow>("SELECT *,lease_until>clock_timestamp() AS lease_fresh FROM runtime_workers WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenant, fence.id]);
    if (!row || row.owner_hash !== fence.ownerHash || row.generation !== fence.generation) throw new WorkerError("Worker ownership or generation changed");
    return row;
  }
  async list() { return this.tx(async tx => (await tx.many<WorkerRow>("SELECT *,lease_until>clock_timestamp() AS lease_fresh FROM runtime_workers WHERE tenant_id=$1 ORDER BY created_at,id LIMIT 501", [this.tenant])).map(publicWorker)); }
  async register(id: string, body: Record<string, unknown>) {
    const fence = workerFence(id, { ...body, generation: 1 });
    if (body.component !== "scheduler" || !Number.isSafeInteger(body.interval_ms) || Number(body.interval_ms) < 1000 || Number(body.interval_ms) > 3600000) throw new WorkerError("Use component scheduler and interval_ms from 1000 to 3600000", 400);
    return this.tx(async tx => {
      await tx.execute("INSERT INTO runtime_workers(id,tenant_id,component,owner_hash,interval_ms) VALUES($1,$2,'scheduler',$3,$4) ON CONFLICT(tenant_id,id) DO NOTHING", [fence.id, this.tenant, fence.ownerHash, body.interval_ms]);
      const row = await tx.one<WorkerRow>("SELECT *,lease_until>clock_timestamp() AS lease_fresh FROM runtime_workers WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenant, fence.id]);
      if (row.state === "stopped" || (row.state === "starting" && !row.lease_fresh)) {
        if (await tx.get("SELECT id FROM worker_operations WHERE tenant_id=$1 AND worker_id=$2 AND status='running' LIMIT 1", [this.tenant, fence.id])) throw new WorkerError("Previous worker execution remains unconfirmed");
        return publicWorker(await tx.one<WorkerRow>("UPDATE runtime_workers SET owner_hash=$3,interval_ms=$4,generation=CASE WHEN state='stopped' THEN generation+1 ELSE generation END,state='starting',desired='running',restart_id=CASE WHEN state='stopped' THEN NULL ELSE restart_id END,heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '30 seconds' WHERE tenant_id=$1 AND id=$2 RETURNING *", [this.tenant, fence.id, fence.ownerHash, body.interval_ms]));
      }
      if (row.owner_hash !== fence.ownerHash || row.interval_ms !== body.interval_ms || !["starting", "running"].includes(row.state)) throw new WorkerError("Worker already exists with another owner, configuration or state"); return publicWorker(row);
    });
  }
  async heartbeat(fence: WorkerFence) { return this.tx(async tx => { const row = await this.owned(tx, fence); if (row.state === 'stopped') throw new WorkerError("Worker is stopped"); if (!row.lease_fresh) throw new WorkerError("Worker lease expired; in-flight work must be reconciled before recovery"); return publicWorker(await tx.one<WorkerRow>("UPDATE runtime_workers SET heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '30 seconds' WHERE tenant_id=$1 AND id=$2 RETURNING *", [this.tenant, fence.id])); }); }
  async started(fence: WorkerFence) { return this.tx(async tx => { const row = await this.owned(tx, fence); if (row.state === "running" && row.desired === "running" && row.lease_fresh) return publicWorker(row); if (row.state !== "starting" || row.desired !== "running" || !row.lease_fresh) throw new WorkerError("Worker generation is not ready to start"); const result = await tx.one<WorkerRow>("UPDATE runtime_workers SET state='running',heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '30 seconds' WHERE tenant_id=$1 AND id=$2 RETURNING *", [this.tenant, fence.id]); if (row.restart_id) await tx.execute("UPDATE worker_restart_requests SET status='complete',new_generation=$3,completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND status='starting'", [this.tenant, row.restart_id, fence.generation]); return publicWorker(result); }); }
  async restart(id: string, key: string) {
return this.tx(async tx => {
      id = workerId(id); key = workerId(key);
      const previous = await tx.get<Record<string, unknown>>("SELECT id,worker_id,status,old_generation,new_generation FROM worker_restart_requests WHERE tenant_id=$1 AND id=$2", [this.tenant, key]); if (previous) { if (previous.worker_id !== id) throw new WorkerError("Restart identity belongs to another worker"); return previous; }
      const row = await tx.get<WorkerRow>("SELECT *,lease_until>clock_timestamp() AS lease_fresh FROM runtime_workers WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenant, id]); if (!row) throw new WorkerError("Worker not found", 404); const replay = await tx.get<Record<string, unknown>>("SELECT id,worker_id,status,old_generation,new_generation FROM worker_restart_requests WHERE tenant_id=$1 AND id=$2", [this.tenant, key]); if (replay) { if (replay.worker_id !== id) throw new WorkerError("Restart identity belongs to another worker"); return replay; } if (row.state !== "running" || row.desired !== "running" || !row.lease_fresh) throw new WorkerError("Worker is not actively owned; restart cannot be confirmed");
      if (row.restart_id && await tx.get("SELECT id FROM worker_restart_requests WHERE tenant_id=$1 AND id=$2 AND status<>'complete'", [this.tenant, row.restart_id])) throw new WorkerError("A restart is already pending");
      await tx.execute("UPDATE runtime_workers SET desired='restart',state='draining',restart_id=$3 WHERE tenant_id=$1 AND id=$2", [this.tenant, id, key]);
      return tx.one<Record<string, unknown>>("INSERT INTO worker_restart_requests(id,tenant_id,worker_id,old_generation,status) VALUES($1,$2,$3,$4,'draining') RETURNING id,worker_id,status,old_generation,new_generation", [key, this.tenant, id, row.generation]);
    });
}
  async restartStatus(id: string, key: string) { return this.tx(async tx => { const row = await tx.get<Record<string, unknown>>("SELECT id,worker_id,status,old_generation,new_generation FROM worker_restart_requests WHERE tenant_id=$1 AND worker_id=$2 AND id=$3", [this.tenant, workerId(id), workerId(key)]); if (!row) throw new WorkerError("Restart request not found", 404); return row; }); }
  async drain(fence: WorkerFence, stop: boolean) {
return this.tx(async tx => {
const row = await this.owned(tx, fence); if (stop && row.state === "stopped") return publicWorker(row); if (!row.lease_fresh) throw new WorkerError("Worker lease expired; drain is not confirmed"); if (await tx.get("SELECT id FROM worker_operations WHERE tenant_id=$1 AND worker_id=$2 AND generation=$3 AND status='running' LIMIT 1", [this.tenant, fence.id, fence.generation])) throw new WorkerError("In-flight server operation has not completed");
      if (stop) { if (row.desired === 'restart') throw new WorkerError("A restart is pending; finish it before stopping"); return publicWorker(await tx.one<WorkerRow>("UPDATE runtime_workers SET state='stopped',desired='stopped',lease_until=clock_timestamp() WHERE tenant_id=$1 AND id=$2 RETURNING *", [this.tenant, fence.id])); }
      if (row.state !== "draining" || row.desired !== "restart" || !row.restart_id) throw new WorkerError("Worker has no pending restart");
      await tx.execute("UPDATE worker_restart_requests SET status='starting' WHERE tenant_id=$1 AND id=$2", [this.tenant, row.restart_id]);
      return publicWorker(await tx.one<WorkerRow>("UPDATE runtime_workers SET generation=generation+1,state='starting',desired='running',heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '30 seconds' WHERE tenant_id=$1 AND id=$2 RETURNING *", [this.tenant, fence.id]));
    });
}
  async stopRequest(fence: WorkerFence) { return this.tx(async tx => { const row = await this.owned(tx, fence); if (row.desired === 'restart') throw new WorkerError("A restart is pending"); return publicWorker(await tx.one<WorkerRow>("UPDATE runtime_workers SET state='draining',desired='stopped' WHERE tenant_id=$1 AND id=$2 RETURNING *", [this.tenant, fence.id])); }); }
  async beginOperation(fence: WorkerFence, id: string) { return this.tx(async tx => { id = workerId(id); const row = await this.owned(tx, fence); const prior = await tx.get<Record<string, unknown>>("SELECT id,status,result,generation FROM worker_operations WHERE tenant_id=$1 AND worker_id=$2 AND id=$3", [this.tenant, fence.id, id]); if (prior) { if (prior.generation !== fence.generation) throw new WorkerError("Operation belongs to another generation"); return { claimed: false, operation: prior }; } if (row.state !== "running" || row.desired !== "running" || !row.lease_fresh) throw new WorkerError("Worker cannot claim new work"); if (await tx.get("SELECT id FROM worker_operations WHERE tenant_id=$1 AND worker_id=$2 AND status='running' LIMIT 1", [this.tenant, fence.id])) throw new WorkerError("Worker already has an in-flight operation"); return { claimed: true, operation: await tx.one<Record<string, unknown>>("INSERT INTO worker_operations(id,tenant_id,worker_id,generation,status) VALUES($1,$2,$3,$4,'running') RETURNING id,status,result,generation", [id, this.tenant, fence.id, fence.generation]) }; }); }
  async finishOperation(fence: WorkerFence, id: string, result: Record<string, unknown>) { return this.tx(async tx => { await this.owned(tx, fence); return tx.one<Record<string, unknown>>("UPDATE worker_operations SET status='complete',result=$5::jsonb,completed_at=clock_timestamp() WHERE tenant_id=$1 AND worker_id=$2 AND generation=$3 AND id=$4 AND status='running' RETURNING id,status,result,generation", [this.tenant, fence.id, fence.generation, workerId(id), JSON.stringify(result)]); }); }
  async operation(fence: WorkerFence, id: string) { return this.tx(async tx => { await this.owned(tx, fence); const row = await tx.get<Record<string, unknown>>("SELECT id,status,result,generation FROM worker_operations WHERE tenant_id=$1 AND worker_id=$2 AND id=$3 AND generation=$4", [this.tenant, fence.id, workerId(id), fence.generation]); if (!row) throw new WorkerError("Worker operation not found", 404); return row; }); }
}
