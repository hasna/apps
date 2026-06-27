import net from "node:net";
import type { CheckAttemptResult, Monitor } from "./types.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<{ status: number }>;

export async function runMonitorCheck(monitor: Monitor, options: { fetch?: FetchLike } = {}): Promise<CheckAttemptResult> {
  if (!monitor.enabled) {
    return { status: "down", latencyMs: null, error: "monitor is disabled" };
  }
  if (monitor.kind === "http") return runHttpCheck(monitor, options.fetch ?? fetch);
  return runTcpCheck(monitor);
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
