import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { request as nodeHttpRequest, type RequestOptions as NodeRequestOptions } from "node:http";
import { request as nodeHttpsRequest } from "node:https";
import type { ChannelConfig, DeliveryAttempt, DeliveryResult, EventEnvelope } from "./types.js";
import { signPayload } from "./signing.js";
import {
  normalizeMaxRedirects,
  resolveWebhookTarget,
  type WebhookTargetPolicy,
} from "./ssrf.js";

export interface TransportTlsOptions {
  /**
   * Override the certificate authorities used by the pinned native transport
   * (for example a private PKI or a self-signed test certificate). Ignored on
   * an injected `fetchImpl` path, where the operator owns TLS. Defaults to the
   * runtime's standard CA store.
   */
  ca?: string | Buffer | Array<string | Buffer>;
}

export interface TransportDispatchOptions {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  secretResolver?: WebhookSecretResolver;
  now?: () => Date;
  /**
   * TLS options for the pinned native transport (the default, non-injected
   * fetch path). `ca` overrides the trusted certificate authorities.
   */
  tls?: TransportTlsOptions;
  /**
   * Webhook-target SSRF policy. When provided, the durable webhook transport
   * validates every target (and every redirect hop) against it. When omitted,
   * the guard still applies on the default `fetch` path and is deferred to an
   * injected `fetchImpl` (the operator who injects a fetch implementation owns
   * the network boundary).
   */
  webhookTargetPolicy?: WebhookTargetPolicy;
}

export type WebhookSecretResolver = (reference: string) => string | undefined | Promise<string | undefined>;

export interface BuildWebhookRequestOptions {
  secret?: string;
  timestamp?: string;
}

function now(): string {
  return new Date().toISOString();
}

function truncate(value: string, max = 4096): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function buildWebhookRequest(
  event: EventEnvelope,
  channel: ChannelConfig,
  options: BuildWebhookRequestOptions = {},
): { body: string; headers: Record<string, string> } {
  if (!channel.webhook) throw new Error(`Channel ${channel.id} has no webhook config`);
  for (const name of Object.keys(channel.webhook.headers ?? {})) {
    if (/^x-hasna-/i.test(name)) {
      throw new Error(`Webhook header ${name} is reserved for signed delivery metadata`);
    }
  }
  const body = JSON.stringify(event);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "@hasna/events",
    "X-Hasna-Event-Id": event.id,
    "X-Hasna-Event-Type": event.type,
    ...channel.webhook.headers,
    "X-Hasna-Timestamp": timestamp,
  };
  const secret = options.secret ?? channel.webhook.secret;
  if (secret) {
    headers["X-Hasna-Signature"] = signPayload(secret, timestamp, body);
  }
  return { body, headers };
}

/**
 * Strips embedded credentials from a webhook URL so both delivery paths (the
 * pinned native transport and an injected `fetchImpl`) behave identically.
 * Credentials in a webhook URL are unsupported: undici refuses them, and
 * silently honoring them on one path but dropping them on another is the
 * inconsistency this removes.
 */
function normalizeWebhookUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username !== "" || url.password !== "") {
    url.username = "";
    url.password = "";
  }
  return url.toString();
}

export async function dispatchWebhook(event: EventEnvelope, channel: ChannelConfig, options: TransportDispatchOptions = {}): Promise<DeliveryAttempt> {
  if (!channel.webhook) throw new Error(`Channel ${channel.id} has no webhook config`);
  const webhookUrl = normalizeWebhookUrl(channel.webhook.url);
  const startedAt = now();
  let secret = channel.webhook.secret;
  if (channel.webhook.secretRef) {
    if (!options.secretResolver) {
      return failedAttempt(startedAt, "Webhook secret reference has no runtime resolver");
    }
    try {
      secret = await options.secretResolver(channel.webhook.secretRef);
    } catch {
      return failedAttempt(startedAt, "Webhook secret reference could not be resolved");
    }
    if (!secret) return failedAttempt(startedAt, "Webhook secret reference could not be resolved");
  }
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  const { body, headers } = buildWebhookRequest(event, channel, { secret, timestamp });

  // SSRF guard applies on the default fetch path always, and on an injected
  // fetchImpl when the caller supplies an explicit policy.
  const validateTargets = options.webhookTargetPolicy !== undefined || options.fetchImpl === undefined;
  if (validateTargets) {
    return dispatchValidatedWebhook(event, channel, { body, headers, startedAt, options });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), channel.webhook.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const responseBody = truncate(await response.text());
    return {
      attempt: 1,
      status: response.ok ? "success" : "failed",
      startedAt,
      completedAt: now(),
      responseStatus: response.status,
      responseBody,
      error: response.ok ? undefined : `Webhook returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      attempt: 1,
      status: "failed",
      startedAt,
      completedAt: now(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function redirectKeepsBody(status: number): boolean {
  return status === 307 || status === 308;
}

/**
 * Performs a single HTTP(S) request that is pinned to the validated address at
 * the connection level while preserving the original hostname for TLS SNI and
 * hostname verification. The URL hostname is never rewritten to the address, so
 * a certificate issued for the hostname verifies normally on Node/undici and
 * Bun alike; the custom `lookup` forces the connect to the validated address,
 * which also closes the DNS-rebinding window (the connection never re-resolves).
 */
async function pinnedNativeRequest(
  target: URL,
  addresses: string[],
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal: AbortSignal,
  tls?: TransportTlsOptions,
): Promise<Response> {
  const isHttps = target.protocol === "https:";
  if (!isHttps && target.protocol !== "http:") {
    throw new Error(`Webhook target uses unsupported protocol ${target.protocol}`);
  }
  const defaultPort = isHttps ? 443 : 80;
  const port = target.port ? Number(target.port) : defaultPort;
  const requestOptions: NodeRequestOptions = {
    hostname: target.hostname,
    port,
    path: `${target.pathname}${target.search}`,
    method,
    headers,
    ...(tls?.ca ? { ca: tls.ca } : {}),
    lookup: (hostname, _options, callback) => {
      // Pin the connection to the validated addresses. The hostname passed in
      // is the URL hostname; we ignore it and connect to the validated set.
      const entries = addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }));
      callback(null, entries);
    },
  };
  return new Promise<Response>((resolve, reject) => {
    const request = isHttps ? nodeHttpsRequest(requestOptions, onResponse) : nodeHttpRequest(requestOptions, onResponse);
    // Wire the abort manually: Bun's node:http compatibility ignores the
    // `signal` request option, so a slow target would otherwise outlive the
    // delivery timeout on the events runtime.
    const onAbort = () => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      request.destroy(error);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();

    function onResponse(response: import("node:http").IncomingMessage): void {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("error", reject);
      response.on("end", () => {
        const headersRecord: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string") headersRecord[name] = value;
          else if (Array.isArray(value)) headersRecord[name] = value.join(", ");
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 200, headers: headersRecord }));
      });
    }
  });
}

async function dispatchValidatedWebhook(
  event: EventEnvelope,
  channel: ChannelConfig,
  input: { body: string; headers: Record<string, string>; startedAt: string; options: TransportDispatchOptions },
): Promise<DeliveryAttempt> {
  const { body, headers, startedAt, options } = input;
  const webhook = channel.webhook;
  if (!webhook) throw new Error(`Channel ${channel.id} has no webhook config`);
  const policy = options.webhookTargetPolicy ?? {};
  const maxRedirects = normalizeMaxRedirects(policy.maxRedirects);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs ?? 15_000);
  try {
    // `target` is the logical hostname URL used for validation, redirect
    // resolution, and TLS verification. The default path pins the connection
    // to the validated address via `pinnedNativeRequest`; an injected
    // `fetchImpl` receives the hostname URL and owns its own network boundary.
    let target = new URL(normalizeWebhookUrl(webhook.url));
    let requestHeaders = headers;
    let method = "POST";
    let requestBody: string | undefined = body;
    let redirectsFollowed = 0;
    for (;;) {
      const resolved = await resolveWebhookTarget(target, policy).catch((error: Error) => {
        throw new Error(`Webhook target rejected by SSRF guard: ${error.message}`);
      });
      const response = options.fetchImpl
        ? await options.fetchImpl(target, {
            method,
            headers: requestHeaders,
            body: requestBody,
            signal: controller.signal,
            redirect: "manual",
          })
        : await pinnedNativeRequest(target, resolved.addresses, method, requestHeaders, requestBody, controller.signal, options.tls);
      const location = response.headers.get("location");
      if (isRedirectStatus(response.status) && location) {
        // Refuse to follow a redirect once the bound is reached; this checks
        // before issuing another request, so at most `maxRedirects` redirect
        // responses are followed (initial request + maxRedirects follows).
        if (redirectsFollowed >= maxRedirects) {
          return failedAttempt(startedAt, `Webhook target exceeded ${maxRedirects} redirects`);
        }
        redirectsFollowed += 1;
        const next = new URL(location, target);
        target = next;
        if (!redirectKeepsBody(response.status)) {
          method = "GET";
          requestBody = undefined;
          requestHeaders = Object.fromEntries(
            Object.entries(requestHeaders).filter(([name]) => name.toLowerCase() !== "content-type" && name.toLowerCase() !== "content-length"),
          );
        }
        continue;
      }
      const responseBody = truncate(await response.text());
      return {
        attempt: 1,
        status: response.ok ? "success" : "failed",
        startedAt,
        completedAt: now(),
        responseStatus: response.status,
        responseBody,
        error: response.ok ? undefined : `Webhook returned HTTP ${response.status}`,
      };
    }
  } catch (error) {
    return {
      attempt: 1,
      status: "failed",
      startedAt,
      completedAt: now(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function failedAttempt(startedAt: string, error: string): DeliveryAttempt {
  return {
    attempt: 1,
    status: "failed",
    startedAt,
    completedAt: now(),
    error,
  };
}

export async function dispatchCommand(event: EventEnvelope, channel: ChannelConfig): Promise<DeliveryAttempt> {
  if (!channel.command) throw new Error(`Channel ${channel.id} has no command config`);
  const startedAt = now();
  const eventJson = JSON.stringify(event);
  const env = {
    ...process.env,
    ...channel.command.env,
    HASNA_CHANNEL_ID: channel.id,
    HASNA_EVENT_ID: event.id,
    HASNA_EVENT_TYPE: event.type,
    HASNA_EVENT_SOURCE: event.source,
    HASNA_EVENT_SUBJECT: event.subject ?? "",
    HASNA_EVENT_SEVERITY: event.severity,
    HASNA_EVENT_TIME: event.time,
    HASNA_EVENT_DEDUPE_KEY: event.dedupeKey ?? "",
    HASNA_EVENT_SCHEMA_VERSION: event.schemaVersion,
    HASNA_EVENT_JSON: eventJson,
  };

  return new Promise((resolve) => {
    const child = spawn(channel.command!.command, channel.command!.args ?? [], {
      cwd: channel.command!.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), channel.command!.timeoutMs ?? 15_000);
    child.stdin.end(eventJson);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        attempt: 1,
        status: "failed",
        startedAt,
        completedAt: now(),
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        error: error.message,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const success = code === 0;
      resolve({
        attempt: 1,
        status: success ? "success" : "failed",
        startedAt,
        completedAt: now(),
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        error: success ? undefined : `Command exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
      });
    });
  });
}

export async function dispatchChannel(event: EventEnvelope, channel: ChannelConfig, options: TransportDispatchOptions = {}): Promise<DeliveryAttempt> {
  if (channel.transport === "webhook") return dispatchWebhook(event, channel, options);
  if (channel.transport === "command") return dispatchCommand(event, channel);
  return {
    attempt: 1,
    status: "skipped",
    startedAt: now(),
    completedAt: now(),
    error: `Unsupported transport: ${channel.transport}`,
  };
}

export function createDeliveryResult(event: EventEnvelope, channel: ChannelConfig, attempts: DeliveryAttempt[]): DeliveryResult {
  const status = attempts.some((attempt) => attempt.status === "success")
    ? "success"
    : attempts.every((attempt) => attempt.status === "skipped")
      ? "skipped"
      : "failed";
  return {
    id: randomUUID(),
    eventId: event.id,
    channelId: channel.id,
    transport: channel.transport,
    status,
    attempts,
    createdAt: attempts[0]?.startedAt ?? now(),
    completedAt: attempts.at(-1)?.completedAt ?? now(),
  };
}
