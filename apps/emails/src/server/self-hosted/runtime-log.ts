/** Fixed, secret-free API worker lifecycle events. This is not container stdout. */
export const RUNTIME_COMPONENTS = ["daemon", "sync", "inbound", "scheduler", "nightly"] as const;
export type RuntimeComponent = typeof RUNTIME_COMPONENTS[number];
export type RuntimeOperation = "scheduled_run" | "forwarding_run" | "sync_s3" | "watch" | "provider_sync" | "smtp_import" | "webhook_relay" | "provision_address" | "provision_job";
export interface RuntimeLogEntry { id: string; request_id: string; component: RuntimeComponent; operation: RuntimeOperation; event: "started" | "returned" | "threw"; http_status: number | null; created_at: string }
export interface RuntimeLogStore { appendRuntimeLog(entry: Omit<RuntimeLogEntry, "id" | "created_at">): Promise<void>; tailRuntimeLogs(component: RuntimeComponent, limit: number): Promise<RuntimeLogEntry[]> }
export function runtimeLogQuery(component: unknown, lines: unknown): { component: RuntimeComponent; limit: number } {
  if (typeof component !== "string" || !RUNTIME_COMPONENTS.includes(component as RuntimeComponent)) throw Error("component must be daemon, sync, inbound, scheduler or nightly");
  if (typeof lines !== "string" || !/^[1-9][0-9]{0,2}$/.test(lines) || Number(lines) > 500) throw Error("lines must be an integer from 1 to 500");
  return { component: component as RuntimeComponent, limit: Number(lines) };
}
export async function withRuntimeLog(store: RuntimeLogStore, component: RuntimeComponent, operation: RuntimeOperation, work: () => Promise<Response>): Promise<Response> {
  const request_id = crypto.randomUUID();
  // A missing sink fails before starting work; readiness must apply migration0037.
  await store.appendRuntimeLog({ request_id, component, operation, event: "started", http_status: null });
  let result: Response;
  try { result = await work(); }
  catch (error) {
    try { await store.appendRuntimeLog({ request_id, component, operation, event: "threw", http_status: null }); }
    catch { /* Never serialize exception details or replace the original operation error. */ }
    throw error;
  }
  try { await store.appendRuntimeLog({ request_id, component, operation, event: "returned", http_status: result.status }); }
  catch {
    // Work may already have committed. Preserve its receipt; never encourage a replay
    // by turning a successfully completed send/import into a logging error response.
    const headers = new Headers(result.headers);
    headers.set("X-Emails-Runtime-Log", "incomplete");
    result = new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  }
  return result;
}
