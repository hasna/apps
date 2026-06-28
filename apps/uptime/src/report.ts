import type { MonitorSummary, ReportDeliveryRecord, UptimeSummary } from "./types.js";

export interface BuildUptimeReportOptions {
  subject?: string;
}

export interface UptimeReport {
  subject: string;
  generatedAt: string;
  summary: UptimeSummary;
  text: string;
  html: string;
  json: Record<string, unknown>;
}

export interface SendUptimeReportOptions extends BuildUptimeReportOptions {
  email?: boolean | UptimeEmailReportTarget;
  sms?: boolean | UptimeSmsReportTarget;
  logs?: boolean | UptimeLogsReportTarget;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface UptimeEmailReportTarget {
  apiUrl?: string;
  sendKey?: string;
  from?: string;
  to?: string | string[];
  subject?: string;
  providerId?: string;
}

export interface UptimeSmsReportTarget {
  apiUrl?: string;
  from?: string;
  to?: string | string[];
}

export interface UptimeLogsReportTarget {
  apiUrl?: string;
  apiKey?: string;
  projectId?: string;
  environment?: string;
  service?: string;
}

export interface UptimeReportDelivery extends ReportDeliveryRecord {}

const DEFAULT_MAILERY_API_URL = "http://localhost:3900";
const DEFAULT_TELEPHONY_API_URL = "http://localhost:19451";
const DEFAULT_LOGS_API_URL = "http://localhost:3460";
const DEFAULT_TIMEOUT_MS = 15_000;

export function buildUptimeReport(summary: UptimeSummary, options: BuildUptimeReportOptions = {}): UptimeReport {
  const subject = options.subject ?? defaultSubject(summary);
  const lines = [
    subject,
    `Generated: ${summary.generatedAt}`,
    `Monitors: ${summary.totals.monitors} total, ${summary.totals.enabled} enabled, ${summary.totals.up} up, ${summary.totals.down} down, ${summary.totals.openIncidents} open incidents`,
    "",
    ...summary.monitors.map(renderMonitorLine),
  ];
  const text = lines.join("\n").trimEnd();
  const json = {
    kind: "open-uptime.report",
    generated_at: summary.generatedAt,
    subject,
    totals: summary.totals,
    monitors: summary.monitors,
  };
  return {
    subject,
    generatedAt: summary.generatedAt,
    summary,
    text,
    html: `<pre>${escapeHtml(text)}</pre>`,
    json,
  };
}

export async function sendUptimeReport(summary: UptimeSummary, options: SendUptimeReportOptions = {}): Promise<UptimeReportDelivery[]> {
  const report = buildUptimeReport(summary, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deliveries: UptimeReportDelivery[] = [];

  if (options.email) {
    deliveries.push(await sendEmailReport(report, resolveEmailTarget(options.email), fetchImpl, timeoutMs));
  }
  if (options.sms) {
    const smsTarget = resolveSmsTarget(options.sms);
    const recipients = splitTargets(smsTarget.to);
    if (recipients.length === 0) {
      deliveries.push(await sendSmsReport(report, smsTarget, fetchImpl, timeoutMs));
    } else {
      for (const target of recipients) {
        deliveries.push(await sendSmsReport(report, { ...smsTarget, to: target }, fetchImpl, timeoutMs));
      }
    }
  }
  if (options.logs) {
    deliveries.push(await sendLogsReport(report, resolveLogsTarget(options.logs), fetchImpl, timeoutMs));
  }

  return deliveries;
}

function defaultSubject(summary: UptimeSummary): string {
  if (summary.totals.openIncidents > 0 || summary.totals.down > 0) {
    return `Open Uptime alert: ${summary.totals.down} down, ${summary.totals.openIncidents} open incidents`;
  }
  return `Open Uptime report: ${summary.totals.up}/${summary.totals.enabled} enabled monitors up`;
}

function renderMonitorLine(item: MonitorSummary): string {
  const uptime = item.uptimePercent == null ? "-" : `${item.uptimePercent.toFixed(2)}%`;
  const latency = item.averageLatencyMs == null ? "-" : `${item.averageLatencyMs}ms`;
  const incident = item.openIncident ? ` open incident: ${item.openIncident.reason ?? "down"}` : "";
  return `- ${item.monitor.status.toUpperCase()} ${item.monitor.name} (${targetLabel(item)}): uptime ${uptime}, latency ${latency}${incident}`;
}

function targetLabel(item: MonitorSummary): string {
  return item.monitor.kind === "tcp" ? `${item.monitor.host}:${item.monitor.port}` : item.monitor.url ?? "";
}

function resolveEmailTarget(value: boolean | UptimeEmailReportTarget): UptimeEmailReportTarget {
  const target = typeof value === "boolean" ? {} : value;
  return {
    apiUrl: target.apiUrl ?? env("HASNA_MAILERY_API_URL", "MAILERY_API_URL") ?? DEFAULT_MAILERY_API_URL,
    sendKey: target.sendKey ?? env("HASNA_MAILERY_SEND_KEY", "MAILERY_SEND_KEY", "ESK"),
    from: target.from ?? env("HASNA_UPTIME_REPORT_EMAIL_FROM", "UPTIME_REPORT_EMAIL_FROM"),
    to: target.to ?? env("HASNA_UPTIME_REPORT_EMAIL_TO", "UPTIME_REPORT_EMAIL_TO"),
    subject: target.subject,
    providerId: target.providerId ?? env("HASNA_MAILERY_PROVIDER_ID", "MAILERY_PROVIDER_ID"),
  };
}

function resolveSmsTarget(value: boolean | UptimeSmsReportTarget): UptimeSmsReportTarget {
  const target = typeof value === "boolean" ? {} : value;
  return {
    apiUrl: target.apiUrl ?? env("HASNA_TELEPHONY_API_URL", "TELEPHONY_API_URL") ?? DEFAULT_TELEPHONY_API_URL,
    from: target.from ?? env("HASNA_UPTIME_REPORT_SMS_FROM", "UPTIME_REPORT_SMS_FROM"),
    to: target.to ?? env("HASNA_UPTIME_REPORT_PHONE_TO", "UPTIME_REPORT_PHONE_TO"),
  };
}

function resolveLogsTarget(value: boolean | UptimeLogsReportTarget): UptimeLogsReportTarget {
  const target = typeof value === "boolean" ? {} : value;
  return {
    apiUrl: target.apiUrl ?? env("HASNA_LOGS_URL", "LOGS_URL") ?? DEFAULT_LOGS_API_URL,
    apiKey: target.apiKey ?? env("HASNA_LOGS_API_TOKEN", "LOGS_API_TOKEN", "HASNA_LOGS_API_KEY", "LOGS_API_KEY"),
    projectId: target.projectId ?? env("HASNA_LOGS_PROJECT_ID", "LOGS_PROJECT_ID") ?? "open-uptime",
    environment: target.environment ?? env("HASNA_ENV", "NODE_ENV"),
    service: target.service ?? "open-uptime",
  };
}

async function sendEmailReport(report: UptimeReport, target: UptimeEmailReportTarget, fetchImpl: typeof fetch, timeoutMs: number): Promise<UptimeReportDelivery> {
  if (!target.sendKey) return { channel: "email", ok: false, error: "Mailery send key is required" };
  if (!target.from) return { channel: "email", ok: false, error: "Email from address is required" };
  if (!hasTargets(target.to)) return { channel: "email", ok: false, error: "Email recipient is required" };
  const body = {
    from: target.from,
    to: splitTargets(target.to),
    subject: target.subject ?? report.subject,
    text: report.text,
    html: report.html,
    provider_id: target.providerId,
  };
  return requestJson("email", `${normalizeUrl(target.apiUrl ?? DEFAULT_MAILERY_API_URL)}/api/v1/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${target.sendKey}` },
    body,
  }, fetchImpl, timeoutMs, secretsForTarget(target));
}

async function sendSmsReport(report: UptimeReport, target: UptimeSmsReportTarget, fetchImpl: typeof fetch, timeoutMs: number): Promise<UptimeReportDelivery> {
  if (!hasTargets(target.to)) return { channel: "sms", ok: false, error: "SMS recipient phone number is required" };
  return requestJson("sms", `${normalizeUrl(target.apiUrl ?? DEFAULT_TELEPHONY_API_URL)}/api/sms/send`, {
    method: "POST",
    body: {
      to: Array.isArray(target.to) ? target.to[0] : target.to,
      from: target.from,
      body: truncateSms(report.text),
    },
  }, fetchImpl, timeoutMs, secretsForTarget(target));
}

async function sendLogsReport(report: UptimeReport, target: UptimeLogsReportTarget, fetchImpl: typeof fetch, timeoutMs: number): Promise<UptimeReportDelivery> {
  const params = new URLSearchParams({
    format: "json",
    source: "structured",
    service: target.service ?? "open-uptime",
    project_id: target.projectId ?? "open-uptime",
  });
  if (target.environment) params.set("environment", target.environment);
  return requestJson("logs", `${normalizeUrl(target.apiUrl ?? DEFAULT_LOGS_API_URL)}/api/logs/structured?${params}`, {
    method: "POST",
    headers: target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : undefined,
    body: {
      timestamp: report.generatedAt,
      level: report.summary.totals.down > 0 || report.summary.totals.openIncidents > 0 ? "warn" : "info",
      message: report.subject,
      report: report.json,
    },
  }, fetchImpl, timeoutMs, secretsForTarget(target));
}

async function requestJson(
  channel: UptimeReportDelivery["channel"],
  url: string,
  options: { method: string; headers?: Record<string, string>; body: unknown },
  fetchImpl: typeof fetch,
  timeoutMs: number,
  secrets: string[] = [],
): Promise<UptimeReportDelivery> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: options.method,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...options.headers,
      },
      body: JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = parseMaybeJson(text);
    if (!response.ok) {
      return { channel, ok: false, status: response.status, error: errorFromResponse(data, response.statusText, secrets) };
    }
    return { channel, ok: true, status: response.status, id: redactOptional(idFromResponse(data), secrets) };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "request timed out"
      : error instanceof Error ? error.message : String(error);
    return { channel, ok: false, error: redactSecrets(message, secrets) };
  } finally {
    clearTimeout(timer);
  }
}

function hasTargets(value: string | string[] | undefined): value is string | string[] {
  return splitTargets(value).length > 0;
}

function splitTargets(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : value.split(",");
  return values.map((item) => item.trim()).filter(Boolean);
}

function normalizeUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Integration API URL must use http or https");
  }
  return parsed.toString().replace(/\/$/, "");
}

function truncateSms(value: string): string {
  return value.length > 1400 ? `${value.slice(0, 1397)}...` : value;
}

function parseMaybeJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function idFromResponse(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["id", "message_id", "event_id"]) {
    if (typeof record[key] === "string") return record[key];
  }
  if (Array.isArray(record.events)) {
    for (const event of record.events) {
      if (!event || typeof event !== "object") continue;
      const eventRecord = event as Record<string, unknown>;
      for (const key of ["id", "event_id"]) {
        if (typeof eventRecord[key] === "string") return eventRecord[key];
      }
    }
  }
  return undefined;
}

function errorFromResponse(data: unknown, fallback: string, secrets: string[] = []): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string") return redactSecrets(record.error, secrets);
    if (typeof record.message === "string") return redactSecrets(record.message, secrets);
  }
  return redactSecrets(fallback, secrets);
}

function env(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function secretsForTarget(target: UptimeEmailReportTarget | UptimeSmsReportTarget | UptimeLogsReportTarget): string[] {
  const values = new Set<string>();
  for (const key of ["sendKey", "apiKey"] as const) {
    const value = (target as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) values.add(value.trim());
  }
  const apiUrl = (target as { apiUrl?: string }).apiUrl;
  if (apiUrl) {
    try {
      const parsed = new URL(apiUrl);
      if (parsed.username) values.add(decodeURIComponent(parsed.username));
      if (parsed.password) values.add(decodeURIComponent(parsed.password));
    } catch {
      // Invalid URLs are rejected by normalizeUrl before network calls.
    }
  }
  return [...values];
}

function redactSecrets(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length >= 3) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\besk_[A-Za-z0-9._~+/=-]+/g, "esk_[REDACTED]");
}

function redactOptional(value: string | undefined, secrets: string[]): string | undefined {
  return value === undefined ? undefined : redactSecrets(value, secrets);
}
