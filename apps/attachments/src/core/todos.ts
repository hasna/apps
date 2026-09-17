/**
 * Todos and Sessions integrations, resolved through the ONE shared credential
 * seam (@hasna/contracts/client) — this module contributes no tier of its own.
 *
 * Each integration resolves the sibling service's own chain fresh per call
 * (Keychain item, `~/.hasna/<service>/config/credentials`, env pair,
 * default fleet gateway), exactly as that service's own client would, and the
 * credential is pinned to the authority it resolved with: a request outside
 * the configured service URL is refused before any header is attached.
 */
import {
  resolveServiceTransport, resolveServiceRequestTransport, stripV1,
  type AttachmentsCredentialChainOptions, type Env,
} from "./client-config";

export type IntegrationService = "TODOS" | "SESSIONS";

export interface ServiceCredentialsConfig {
  url: string;
  key: string;
}

export interface ResolveServiceConfigOptions {
  /** Tier-1 credential inputs and Keychain-tier controls, as accepted by the shared seam. */
  credentials?: AttachmentsCredentialChainOptions;
}

/**
 * Resolve one integration's authority and credential, fresh.
 *
 * Throws when the service's chain resolves an authority but no credential, or
 * when a declared pair is blank or conflicting — integrations never fall back
 * to anything else.
 */
export async function serviceConfig(
  service: IntegrationService,
  env: Env = process.env,
  options: ResolveServiceConfigOptions = {},
): Promise<ServiceCredentialsConfig> {
  const name = service.toLowerCase();
  const resolution = await resolveServiceRequestTransport(name, env, options);
  return { url: resolution.url, key: resolution.apiKey };
}

export async function withServiceAuth(
  service: IntegrationService,
  requestUrl?: string | URL,
  init?: RequestInit,
): Promise<RequestInit> {
  const name = service.toLowerCase();
  const admitted = resolveServiceTransport(name);
  const url = new URL(String(requestUrl));
  const boundary = service === "TODOS" ? "/v1/" : "/api/";
  if (url.username || url.password || !url.href.startsWith(admitted.url + boundary)) {
    throw new Error(`Request is outside the configured ${service} API URL.`);
  }
  const config = await resolveServiceRequestTransport(name, process.env, {}, admitted.url);
  const headers = new Headers(init?.headers);
  headers.delete("authorization");
  headers.set("x-api-key", config.apiKey);
  return { ...init, headers, redirect: "error" };
}

export function withTodosAuth(requestUrl?: string | URL, init?: RequestInit): Promise<RequestInit> {
  return withServiceAuth("TODOS", requestUrl, init);
}

/** Compose one current task route without treating a task reference as a path. */
export function todosTaskUrl(base: string, taskId: string, action?: "history" | "complete"): string {
  if (!taskId.trim() || taskId === "." || taskId === "..") throw new Error("A task ID is required.");
  return `${stripV1(base)}/v1/tasks/${encodeURIComponent(taskId)}${action ? `/${action}` : ""}`;
}

export function todoRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid Todos ${label} response.`);
  return value as Record<string, unknown>;
}

/** No redirect, write retry, legacy route retry or private error body rendering. */
export async function requestTodosJson(
  url: string,
  taskId: string,
  init: RequestInit = {},
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const request = await withTodosAuth(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) });
  let response: Response;
  try { response = await fetchFn(url, request); }
  catch { throw new Error(`Todos request failed for task ${taskId}: transport error.`); }
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Task not found: ${taskId} (HTTP 404).`);
    throw new Error(`Todos request failed for task ${taskId}: HTTP ${response.status}.`);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error("Invalid Todos JSON response."); }
  return todoRecord(data, "envelope");
}

export function taskFromEnvelope(envelope: Record<string, unknown>): Record<string, unknown> & { id: string } {
  const task = todoRecord(envelope.task, "task");
  if (typeof task.id !== "string" || !task.id.trim()) throw new Error("Invalid Todos task identity.");
  return task as Record<string, unknown> & { id: string };
}

export async function readTodosTask(taskId: string, base: string, fetchFn: typeof fetch = fetch) {
  return taskFromEnvelope(await requestTodosJson(todosTaskUrl(base, taskId), taskId, {}, fetchFn));
}

export function taskWriteVersion(task: Record<string, unknown>): number {
  if (!Number.isSafeInteger(task.version) || (task.version as number) < 1) throw new Error("Todos task has no valid write version.");
  return task.version as number;
}

export function taskMetadata(task: Record<string, unknown>): Record<string, unknown> {
  return task.metadata === undefined || task.metadata === null ? {} : todoRecord(task.metadata, "metadata");
}
