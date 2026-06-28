import net from "node:net";
import type { BrowserFailedRequest, BrowserPageEvidence, CheckAttemptResult, EvidenceArtifact, Monitor } from "./types.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<{ status: number }>;
export type BrowserPageRunner = (monitor: Monitor) => Promise<BrowserPageRunnerResult>;

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

export async function runMonitorCheck(monitor: Monitor, options: { fetch?: FetchLike; browserPage?: BrowserPageRunner } = {}): Promise<CheckAttemptResult> {
  if (!monitor.enabled) {
    return { status: "down", latencyMs: null, error: "monitor is disabled" };
  }
  if (monitor.kind === "http") return runHttpCheck(monitor, options.fetch ?? fetch);
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
