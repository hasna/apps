import dns from "node:dns/promises";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import net from "node:net";
import { assertHostedHttpUrlAllowed, assertHostedResolvedAddressesAllowed, normalizeHostedHost, type HostedResolvedAddress } from "./target-policy.js";
import type { BrowserFailedRequest, BrowserPageEvidence, CheckAttemptResult, EvidenceArtifact, HttpTargetPolicyDecision, HttpTargetPolicyEvidence, Monitor } from "./types.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<{ status: number }>;
export type BrowserPageRunner = (monitor: Monitor) => Promise<BrowserPageRunnerResult>;
export type HostedDnsResolver = (hostname: string) => Promise<HostedResolvedAddress[]>;
export type HostedHttpRequestLike = (context: HostedHttpRequestContext) => Promise<HostedHttpResponse>;

export interface MonitorCheckOptions {
  fetch?: FetchLike;
  browserPage?: BrowserPageRunner;
  hostedTargetPolicy?: boolean;
  resolveHost?: HostedDnsResolver;
  hostedHttpRequest?: HostedHttpRequestLike;
  maxRedirects?: number;
}

export interface HostedHttpCheckOptions {
  resolveHost?: HostedDnsResolver;
  request?: HostedHttpRequestLike;
  maxRedirects?: number;
}

export interface HostedHttpRequestContext {
  url: URL;
  method: string;
  timeoutMs: number;
  address: {
    address: string;
    family: 4 | 6;
  };
  signal: AbortSignal;
}

export interface HostedHttpResponse {
  status: number;
  headers?: Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}

export interface BrowserPageRunnerResult {
  finalUrl?: string | null;
  navigationStatus?: number | null;
  consoleErrors?: string[];
  pageErrors?: string[];
  failedRequests?: BrowserFailedRequest[];
  screenshot?: (Partial<EvidenceArtifact> & { ref: string; path?: string }) | null;
  artifacts?: Array<Partial<EvidenceArtifact> & { ref: string; path?: string }>;
  latencyMs?: number | null;
}

export async function runMonitorCheck(monitor: Monitor, options: MonitorCheckOptions = {}): Promise<CheckAttemptResult> {
  if (!monitor.enabled) {
    return { status: "down", latencyMs: null, error: "monitor is disabled" };
  }
  if (monitor.kind === "http") {
    return options.hostedTargetPolicy
      ? runHostedHttpCheck(monitor, {
        resolveHost: options.resolveHost,
        request: options.hostedHttpRequest,
        maxRedirects: options.maxRedirects,
      })
      : runHttpCheck(monitor, options.fetch ?? fetch);
  }
  if (monitor.kind === "browser_page") return runBrowserPageCheck(monitor, { fetch: options.fetch, runner: options.browserPage });
  if (monitor.kind === "tcp") return runTcpCheck(monitor);
  return { status: "down", latencyMs: null, error: `unsupported monitor kind: ${(monitor as { kind?: string }).kind ?? "unknown"}` };
}

export async function runHttpCheck(monitor: Monitor, fetchImpl: FetchLike = fetch): Promise<CheckAttemptResult> {
  if (!monitor.url) return { status: "down", latencyMs: null, error: "missing url" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), monitor.timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(monitor.url, {
      method: monitor.method || "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const latencyMs = Math.round((performance.now() - started) * 100) / 100;
    const ok = monitor.expectedStatus == null
      ? response.status >= 200 && response.status < 400
      : response.status === monitor.expectedStatus;
    return {
      status: ok ? "up" : "down",
      latencyMs,
      statusCode: response.status,
      error: ok ? null : `unexpected status ${response.status}`,
    };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runHostedHttpCheck(monitor: Monitor, options: HostedHttpCheckOptions = {}): Promise<CheckAttemptResult> {
  if (!monitor.url) return { status: "down", latencyMs: null, error: "missing url" };
  const resolver = options.resolveHost ?? resolveHostedHost;
  const request = options.request ?? requestHostedHttpPinned;
  const maxRedirects = options.maxRedirects ?? 5;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), monitor.timeoutMs);
  const started = performance.now();
  const decisions: HttpTargetPolicyDecision[] = [];
  let currentUrl: URL;
  let redirectCount = 0;

  try {
    currentUrl = new URL(monitor.url);
  } catch (error) {
    clearTimeout(timeout);
    return {
      status: "down",
      latencyMs: 0,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
      evidence: hostedHttpEvidence(null, redirectCount, decisions),
    };
  }

  try {
    while (true) {
      throwIfAborted(controller.signal);
      const stage = redirectCount === 0 ? "request" : "redirect";
      const address = await resolveAndRecordHostedHttpDecision(currentUrl, stage, resolver, decisions);
      const response = await request({
        url: currentUrl,
        method: monitor.method || "GET",
        timeoutMs: monitor.timeoutMs,
        address,
        signal: controller.signal,
      });
      const location = redirectLocation(response.headers);
      if (isRedirectStatus(response.status) && location) {
        if (redirectCount >= maxRedirects) {
          const latencyMs = elapsed(started);
          return {
            status: "down",
            latencyMs,
            statusCode: response.status,
            error: `too many redirects after ${maxRedirects}`,
            evidence: hostedHttpEvidence(currentUrl, redirectCount, decisions),
          };
        }
        currentUrl = new URL(location, currentUrl);
        redirectCount += 1;
        continue;
      }

      const latencyMs = elapsed(started);
      const ok = monitor.expectedStatus == null
        ? response.status >= 200 && response.status < 400
        : response.status === monitor.expectedStatus;
      return {
        status: ok ? "up" : "down",
        latencyMs,
        statusCode: response.status,
        error: ok ? null : `unexpected status ${response.status}`,
        evidence: hostedHttpEvidence(currentUrl, redirectCount, decisions),
      };
    }
  } catch (error) {
    const latencyMs = elapsed(started);
    return {
      status: "down",
      latencyMs,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
      evidence: hostedHttpEvidence(currentUrl, redirectCount, decisions),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runTcpCheck(monitor: Monitor): Promise<CheckAttemptResult> {
  if (!monitor.host || !monitor.port) return { status: "down", latencyMs: null, error: "missing host or port" };
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: monitor.host!, port: monitor.port!, timeout: monitor.timeoutMs });
    let settled = false;
    const finish = (result: CheckAttemptResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => {
      finish({ status: "up", latencyMs: Math.round((performance.now() - started) * 100) / 100, statusCode: null, error: null });
    });
    socket.once("timeout", () => {
      finish({ status: "down", latencyMs: Math.round((performance.now() - started) * 100) / 100, statusCode: null, error: "tcp timeout" });
    });
    socket.once("error", (error) => {
      finish({ status: "down", latencyMs: Math.round((performance.now() - started) * 100) / 100, statusCode: null, error: error.message });
    });
  });
}

export async function runBrowserPageCheck(
  monitor: Monitor,
  options: { fetch?: FetchLike; runner?: BrowserPageRunner } = {},
): Promise<CheckAttemptResult> {
  if (!monitor.url) return { status: "down", latencyMs: null, error: "missing url" };
  validateBrowserPageUrl(monitor.url);
  if (!options.runner) {
    const evidence = normalizeBrowserEvidence(monitor.url, {
      finalUrl: monitor.url,
      navigationStatus: null,
      pageErrors: ["browser_page checks require a configured browser runner"],
    });
    return {
      status: "down",
      latencyMs: null,
      statusCode: null,
      error: "browser_page checks require a configured browser runner",
      evidence,
    };
  }
  const started = performance.now();
  try {
    const raw = await options.runner(monitor);
    const latencyMs = raw.latencyMs ?? Math.round((performance.now() - started) * 100) / 100;
    const evidence = normalizeBrowserEvidence(monitor.url, raw);
    const statusCode = raw.navigationStatus ?? evidence.navigationStatus;
    const statusOk = statusCode == null
      ? false
      : monitor.expectedStatus == null
        ? statusCode >= 200 && statusCode < 400
        : statusCode === monitor.expectedStatus;
    const browserFailures = evidence.consoleErrors.length + evidence.pageErrors.length + evidence.failedRequests.length;
    return {
      status: statusOk && browserFailures === 0 ? "up" : "down",
      latencyMs,
      statusCode,
      error: statusOk
        ? browserFailures === 0 ? null : `browser page captured ${browserFailures} error signal${browserFailures === 1 ? "" : "s"}`
        : `unexpected navigation status ${statusCode ?? "unknown"}`,
      evidence,
    };
  } catch (error) {
    const safeError = redactText(error instanceof Error ? error.message : String(error));
    const evidence = normalizeBrowserEvidence(monitor.url, {
      finalUrl: monitor.url,
      navigationStatus: null,
      pageErrors: [safeError],
    });
    return {
      status: "down",
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      statusCode: null,
      error: safeError,
      evidence,
    };
  }
}

export function normalizeBrowserEvidence(sourceUrl: string, raw: BrowserPageRunnerResult): BrowserPageEvidence {
  return {
    kind: "browser_page",
    finalUrl: raw.finalUrl ? redactUrl(raw.finalUrl) : redactUrl(sourceUrl),
    navigationStatus: raw.navigationStatus ?? null,
    consoleErrors: sanitizeStrings(raw.consoleErrors ?? []),
    pageErrors: sanitizeStrings(raw.pageErrors ?? []),
    failedRequests: (raw.failedRequests ?? []).slice(0, 50).map((request) => ({
      url: redactUrl(request.url),
      statusCode: request.statusCode ?? null,
      error: request.error ? redactText(request.error) : null,
    })),
    screenshot: raw.screenshot ? sanitizeArtifact(raw.screenshot) : null,
    artifacts: (raw.artifacts ?? []).slice(0, 20).map(sanitizeArtifact),
    redacted: true,
    redactionStatus: "redacted",
    retentionClass: "short",
  };
}

export function normalizeHttpTargetPolicyEvidence(raw: HttpTargetPolicyEvidence): HttpTargetPolicyEvidence {
  if (!isHttpTargetPolicyEvidence(raw)) throw new Error("HTTP target-policy evidence is invalid");
  return {
    kind: "http_target_policy",
    mode: "hosted",
    finalUrl: raw.finalUrl ? redactUrl(raw.finalUrl) : null,
    redirectCount: Math.max(0, Math.min(20, Math.trunc(raw.redirectCount))),
    decisions: raw.decisions.slice(0, 20).map((decision) => ({
      stage: decision.stage,
      decision: decision.decision,
      url: redactUrl(decision.url),
      host: redactText(normalizeHostedHost(decision.host)),
      targetClass: "public_http",
      probeClass: "public",
      protocol: decision.protocol,
      resolvedAddresses: decision.resolvedAddresses.slice(0, 20).map((address) => ({
        address: normalizeHostedHost(address.address),
        family: address.family,
      })),
      ruleId: redactText(decision.ruleId),
      reason: decision.reason ? redactText(decision.reason) : null,
    })),
    redacted: true,
    redactionStatus: "redacted",
    retentionClass: "short",
  };
}

export function isBrowserPageEvidence(value: unknown): value is BrowserPageEvidence {
  return Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "browser_page");
}

export function isHttpTargetPolicyEvidence(value: unknown): value is HttpTargetPolicyEvidence {
  if (!value || typeof value !== "object" || (value as { kind?: unknown }).kind !== "http_target_policy") return false;
  const evidence = value as Partial<HttpTargetPolicyEvidence>;
  return evidence.mode === "hosted"
    && (evidence.finalUrl === null || typeof evidence.finalUrl === "string")
    && Number.isInteger(evidence.redirectCount)
    && evidence.redacted === true
    && evidence.redactionStatus === "redacted"
    && evidence.retentionClass === "short"
    && Array.isArray(evidence.decisions)
    && evidence.decisions.every((decision) => (
      decision
      && (decision.stage === "request" || decision.stage === "redirect")
      && (decision.decision === "allowed" || decision.decision === "blocked")
      && (decision.protocol === "http:" || decision.protocol === "https:")
      && decision.targetClass === "public_http"
      && decision.probeClass === "public"
      && typeof decision.url === "string"
      && typeof decision.host === "string"
      && typeof decision.ruleId === "string"
      && (decision.reason === null || typeof decision.reason === "string")
      && Array.isArray(decision.resolvedAddresses)
      && decision.resolvedAddresses.every((address) => address && typeof address.address === "string" && (address.family === 4 || address.family === 6))
    ));
}

function validateBrowserPageUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("browser_page monitors require an http or https URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("browser_page URLs must not contain userinfo");
  }
}

function sanitizeStrings(values: string[]): string[] {
  return values.slice(0, 50).map(redactText).filter(Boolean);
}

function sanitizeArtifact(artifact: Partial<EvidenceArtifact> & { ref: string; path?: string }): EvidenceArtifact {
  const ref = artifact.ref.trim();
  if (artifact.path || ref.startsWith("/") || ref.toLowerCase().startsWith("file:")) {
    throw new Error("browser evidence artifacts must use redacted artifact refs, not local paths");
  }
  if (!artifact.sha256 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    throw new Error("browser evidence artifacts require a sha256 checksum");
  }
  const bytes = artifact.bytes;
  if (!Number.isInteger(bytes) || bytes == null || bytes < 0) {
    throw new Error("browser evidence artifacts require a byte size");
  }
  return {
    ref: redactText(ref),
    sha256: artifact.sha256,
    bytes,
    contentType: redactText(artifact.contentType ?? "application/octet-stream") || "application/octet-stream",
    retentionClass: "short",
  };
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "[blocked-url]";
    }
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    for (const key of parsed.searchParams.keys()) {
      if (isSecretKey(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return redactText(value);
  }
}

function redactText(value: string): string {
  return value
    .replace(/\/(?:home|Users)\/[^\s"'<>]+/g, "[local-path]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/((?:token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)[=:]\s*)[^\s&]+/gi, "$1[redacted]");
}

function isSecretKey(value: string): boolean {
  return /(token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)/i.test(value);
}

async function resolveAndRecordHostedHttpDecision(
  url: URL,
  stage: "request" | "redirect",
  resolver: HostedDnsResolver,
  decisions: HttpTargetPolicyDecision[],
): Promise<{ address: string; family: 4 | 6 }> {
  let addresses: Array<{ address: string; family: 4 | 6 }> = [];
  try {
    assertHostedHttpUrlAllowed(url.toString());
    addresses = normalizeResolvedAddresses(await resolver(normalizeHostedHost(url.hostname)));
    assertHostedResolvedAddressesAllowed(url.hostname, addresses, "HTTP resolved address");
    decisions.push({
      stage,
      decision: "allowed",
      url: sanitizePolicyUrl(url),
      host: normalizeHostedHost(url.hostname),
      targetClass: "public_http",
      probeClass: "public",
      protocol: url.protocol as "http:" | "https:",
      resolvedAddresses: addresses,
      ruleId: "hosted-http-runtime-target-policy",
      reason: null,
    });
    return addresses[0];
  } catch (error) {
    decisions.push({
      stage,
      decision: "blocked",
      url: sanitizePolicyUrl(url),
      host: normalizeHostedHost(url.hostname),
      targetClass: "public_http",
      probeClass: "public",
      protocol: url.protocol === "http:" || url.protocol === "https:" ? url.protocol : "http:",
      resolvedAddresses: addresses,
      ruleId: "hosted-http-runtime-target-policy",
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function resolveHostedHost(hostname: string): Promise<HostedResolvedAddress[]> {
  const host = normalizeHostedHost(hostname);
  const ipVersion = net.isIP(host);
  if (ipVersion === 4 || ipVersion === 6) return [{ address: host, family: ipVersion }];
  return dns.lookup(host, { all: true, verbatim: true });
}

function normalizeResolvedAddresses(addresses: HostedResolvedAddress[]): Array<{ address: string; family: 4 | 6 }> {
  return addresses.map((entry) => {
    const address = normalizeHostedHost(entry.address);
    const detected = net.isIP(address);
    const family = entry.family === 4 || entry.family === 6 ? entry.family : detected;
    if (family !== 4 && family !== 6) {
      throw new Error("HTTP resolved address is not allowed in hosted mode: DNS returned a non-IP address");
    }
    return { address, family };
  });
}

function hostedHttpEvidence(finalUrl: URL | null, redirectCount: number, decisions: HttpTargetPolicyDecision[]): HttpTargetPolicyEvidence {
  return {
    kind: "http_target_policy",
    mode: "hosted",
    finalUrl: finalUrl ? sanitizePolicyUrl(finalUrl) : null,
    redirectCount,
    decisions,
    redacted: true,
    redactionStatus: "redacted",
    retentionClass: "short",
  };
}

function sanitizePolicyUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.username = "";
  copy.password = "";
  copy.hash = "";
  for (const key of copy.searchParams.keys()) {
    if (isSecretKey(key)) copy.searchParams.set(key, "[redacted]");
  }
  return copy.toString();
}

function redirectLocation(headers: HostedHttpResponse["headers"]): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get("location");
  const raw = headers.location ?? headers.Location;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function requestHostedHttpPinned(context: HostedHttpRequestContext): Promise<HostedHttpResponse> {
  const lookup = (
    _hostname: string,
    _options: unknown,
    callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ) => callback(null, context.address.address, context.address.family);
  return context.url.protocol === "https:"
    ? requestWithClient(context, https, new https.Agent({ lookup }))
    : requestWithClient(context, http, new http.Agent({ lookup }));
}

function requestWithClient(
  context: HostedHttpRequestContext,
  client: typeof http | typeof https,
  agent: http.Agent | https.Agent,
): Promise<HostedHttpResponse> {
  return new Promise((resolve, reject) => {
    const req = client.request(context.url, {
      method: context.method,
      agent,
      signal: context.signal,
      timeout: context.timeoutMs,
    }, (response) => {
      response.resume();
      response.once("end", () => {
        agent.destroy();
        resolve({ status: response.statusCode ?? 0, headers: response.headers });
      });
    });
    req.once("timeout", () => {
      req.destroy(new Error("http timeout"));
    });
    req.once("error", (error) => {
      agent.destroy();
      reject(error);
    });
    req.end();
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("http timeout");
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}
