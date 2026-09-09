import { loadEmailsClientEnvSecret } from "./client-env.js";
import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import type { EmailsSelfHostClient } from "../selfhost.js";
export type WorkerView = Awaited<ReturnType<EmailsSelfHostClient["listWorkers"]>>["items"][number];
export type WorkerControl = Parameters<EmailsSelfHostClient["controlWorker"]>[1];
export type WorkerReceipt = Awaited<ReturnType<EmailsSelfHostClient["controlWorker"]>>;
export class WorkerApiError extends Error { constructor(readonly status: number) { super([404, 405].includes(status) ? "Worker or operation unavailable; verify its ID and update the Emails API if needed." : `Worker API operation was not confirmed (HTTP ${status}); inspect its durable request identity.`); } }
export interface WorkerApi { list(): Promise<{ items: WorkerView[]; complete: boolean }>; control(id: string, body: WorkerControl): Promise<WorkerReceipt> }
export function createWorkerApi(): WorkerApi {
  async function request<T>(run: (client: EmailsSelfHostClient) => Promise<T>): Promise<T> {
    const { EmailsSelfHostClient, ApiError } = await import("../selfhost.js"); loadEmailsClientEnvSecret(process.env); const transport = resolveEmailsHostedTransport(process.env);
    const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
    for (let i = 0; i < credentials.length; i++) { try { return await run(new EmailsSelfHostClient({ baseUrl: transport.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, ""), bearerToken: credentials[i] })); } catch (error) { if (error instanceof ApiError && error.status === 401 && i < credentials.length - 1) continue; if (error instanceof ApiError) throw new WorkerApiError(error.status); throw new WorkerApiError(0); } }
    throw new WorkerApiError(401);
  }
  return { list: () => request(client => client.listWorkers({ signal: AbortSignal.timeout(15000) })), control: (id, body) => request(client => client.controlWorker(id, body, { signal: AbortSignal.timeout(15000) })) };
}
