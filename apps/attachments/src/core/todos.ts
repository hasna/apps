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
  resolveClientTransport,
  resolveCredential,
} from "@hasna/contracts/client";
import { stripV1, type AttachmentsCredentialChainOptions, type Env } from "./client-config";

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
export function serviceConfig(
  service: IntegrationService,
  env: Env = process.env,
  options: ResolveServiceConfigOptions = {},
): ServiceCredentialsConfig {
  const name = service.toLowerCase();
  const credentials = options.credentials ?? {};
  const credential = resolveCredential(name, env, credentials);
  const chainOptions = credential
    ? { credentials: { ...credentials, apiKey: credential.apiKey } }
    : { credentials };
  const resolution = resolveClientTransport(name, env, chainOptions);
  if (!credential) {
    throw new Error(`Missing ${service} API configuration: no credential resolved through the shared chain.`);
  }
  return { url: stripV1(resolution.baseUrl), key: credential.apiKey };
}

export function withServiceAuth(
  service: IntegrationService,
  requestUrl?: string | URL,
  init?: RequestInit,
): RequestInit {
  const config = serviceConfig(service);
  const url = new URL(String(requestUrl));
  const boundary = service === "TODOS" ? "/v1/" : "/api/";
  if (url.username || url.password || !url.href.startsWith(config.url + boundary)) {
    throw new Error(`Request is outside the configured ${service} API URL.`);
  }
  const headers = new Headers(init?.headers);
  headers.delete("authorization");
  headers.set("x-api-key", config.key);
  return { ...init, headers, redirect: "error" };
}

export function withTodosAuth(requestUrl?: string | URL, init?: RequestInit): RequestInit {
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
  const request = withTodosAuth(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) });
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
