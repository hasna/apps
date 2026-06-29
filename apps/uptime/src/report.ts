import { createHash } from "node:crypto";
import type { HostedReportChannelRef, HostedReportChannelRefCatalog, HostedReportChannelService } from "./report-channel-refs.js";
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

export interface SendHostedUptimeReportOptions extends BuildUptimeReportOptions {
  workspaceId: string;
  catalog: HostedReportChannelRefCatalog;
  channelRefIds: string[];
  loadSecret: HostedReportChannelSecretLoader;
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
  apiKey?: string;
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

export type HostedReportChannelSecretPayload =
  | HostedMaileryChannelSecretPayload
  | HostedTelephonyChannelSecretPayload
  | HostedLogsChannelSecretPayload;

export type HostedReportChannelSecretLoader = (
  secretRef: string,
  channelRef: HostedReportChannelRef,
) => Promise<string | Record<string, unknown>> | string | Record<string, unknown>;

export interface HostedReportDelivery extends UptimeReportDelivery {
  channelRefId: string;
  provider: HostedReportChannelService;
  targetRef: string | null;
  targetRefHash: string | null;
  requestHash: string | null;
  redacted: true;
}

interface HostedReportChannelSecretBase {
  version: "open-uptime.report-channel-secret.v1";
  service: HostedReportChannelService;
  targetRef?: string;
  apiUrl?: string;
}

export interface HostedMaileryChannelSecretPayload extends HostedReportChannelSecretBase {
  service: "mailery";
  sendKey: string;
  from: string;
  to: string | string[];
  subject?: string;
  providerId?: string;
}

export interface HostedTelephonyChannelSecretPayload extends HostedReportChannelSecretBase {
  service: "telephony";
  apiKey?: string;
  from?: string;
  to: string | string[];
}

export interface HostedLogsChannelSecretPayload extends HostedReportChannelSecretBase {
  service: "logs";
  apiKey?: string;
  projectId?: string;
  environment?: string;
  serviceName?: string;
}

const DEFAULT_MAILERY_API_URL = "http://localhost:3900";
const DEFAULT_TELEPHONY_API_URL = "http://localhost:19451";
const DEFAULT_LOGS_API_URL = "http://localhost:3460";
const DEFAULT_TIMEOUT_MS = 15_000;
const SECRET_URL_PARAM_PATTERN = /(token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session|signature|oauth)/i;
const SECRET_URL_PARAM_EXACT_NAMES = new Set(["key", "sig", "signature", "jwt", "code"]);

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
    const emailTarget = resolveEmailTarget(options.email);
    deliveries.push(await sendReportSafely("email", emailTarget, () => sendEmailReport(report, emailTarget, fetchImpl, timeoutMs)));
  }
  if (options.sms) {
    const smsTarget = resolveSmsTarget(options.sms);
    const recipients = splitTargets(smsTarget.to);
    if (recipients.length === 0) {
      deliveries.push(await sendReportSafely("sms", smsTarget, () => sendSmsReport(report, smsTarget, fetchImpl, timeoutMs)));
    } else {
      for (const target of recipients) {
        const perRecipientTarget = { ...smsTarget, to: target };
        deliveries.push(await sendReportSafely("sms", perRecipientTarget, () => sendSmsReport(report, perRecipientTarget, fetchImpl, timeoutMs)));
      }
    }
  }
  if (options.logs) {
    const logsTarget = resolveLogsTarget(options.logs);
    deliveries.push(await sendReportSafely("logs", logsTarget, () => sendLogsReport(report, logsTarget, fetchImpl, timeoutMs)));
  }

  return deliveries;
}

export async function sendHostedUptimeReport(summary: UptimeSummary, options: SendHostedUptimeReportOptions): Promise<HostedReportDelivery[]> {
  const report = buildHostedUptimeReport(summary, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const channels = hostedChannelsForWorkspace(options.catalog, options.workspaceId, options.channelRefIds);
  const deliveries: HostedReportDelivery[] = [];

  for (const channelRef of channels) {
    let payload: HostedReportChannelSecretPayload;
    try {
      payload = parseHostedReportChannelSecretPayload(await options.loadSecret(channelRef.secretRef, channelRef), channelRef);
    } catch (error) {
      deliveries.push(hostedFailure(channelRef, error, hostedRefRedactions(channelRef)));
      continue;
    }

    const requestHash = hostedDeliveryRequestHash(report, channelRef, payload);
    const targetRef = channelRef.targetRef ?? payload.targetRef ?? null;
    const redactions = hostedDeliveryRedactions(channelRef, payload);
    if (payload.service === "mailery") {
      const target: UptimeEmailReportTarget = {
        apiUrl: payload.apiUrl,
        sendKey: payload.sendKey,
        from: payload.from,
        to: payload.to,
        subject: payload.subject ?? options.subject,
        providerId: payload.providerId,
      };
      deliveries.push(await sendHostedReportSafely(channelRef, targetRef, requestHash, redactions, () =>
        sendEmailReport(report, target, fetchImpl, timeoutMs)));
      continue;
    }
    if (payload.service === "telephony") {
      const target: UptimeSmsReportTarget = {
        apiUrl: payload.apiUrl,
        apiKey: payload.apiKey,
        from: payload.from,
        to: payload.to,
      };
      const recipients = splitTargets(target.to);
      if (recipients.length <= 1) {
        deliveries.push(await sendHostedReportSafely(channelRef, targetRef, requestHash, redactions, () =>
          sendSmsReport(report, target, fetchImpl, timeoutMs)));
      } else {
        for (const recipient of recipients) {
          const perRecipientHash = sha256(`${requestHash}\u001f${recipient}`);
          deliveries.push(await sendHostedReportSafely(channelRef, targetRef, perRecipientHash, redactions, () =>
            sendSmsReport(report, { ...target, to: recipient }, fetchImpl, timeoutMs)));
        }
      }
      continue;
    }
    const target: UptimeLogsReportTarget = {
      apiUrl: payload.apiUrl,
      apiKey: payload.apiKey,
      projectId: payload.projectId,
      environment: payload.environment,
      service: payload.serviceName,
    };
    deliveries.push(await sendHostedReportSafely(channelRef, targetRef, requestHash, redactions, () =>
      sendLogsReport(report, target, fetchImpl, timeoutMs)));
  }

  return deliveries;
}

function buildHostedUptimeReport(summary: UptimeSummary, options: BuildUptimeReportOptions = {}): UptimeReport {
  const report = buildUptimeReport(redactSummaryTargets(summary), options);
  return {
    ...report,
    json: {
      ...report.json,
      redacted: true,
      redaction_policy: "open-uptime.hosted-report-redaction.v1",
    },
  };
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
    headers: target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : undefined,
    body: {
      to: Array.isArray(target.to) ? target.to[0] : target.to,
      from: target.from,
      body: truncateSms(report.text),
    },
  }, fetchImpl, timeoutMs, secretsForTarget(target));
}

async function sendHostedReportSafely(
  channelRef: HostedReportChannelRef,
  targetRef: string | null,
  requestHash: string,
  redactions: string[],
  action: () => Promise<UptimeReportDelivery>,
): Promise<HostedReportDelivery> {
  const delivery = await sendReportSafely(channelRef.channel, {}, action);
  return {
    ...delivery,
    id: delivery.id === undefined ? undefined : redactHostedEvidence(delivery.id, redactions),
    error: delivery.error === undefined ? undefined : redactHostedEvidence(delivery.error, redactions),
    channelRefId: channelRef.id,
    provider: channelRef.service,
    targetRef: null,
    targetRefHash: targetRef ? sha256(targetRef) : null,
    requestHash,
    redacted: true,
  };
}

function hostedFailure(channelRef: HostedReportChannelRef, error: unknown, redactions: string[] = []): HostedReportDelivery {
  const message = error instanceof Error ? error.message : String(error);
  return {
    channel: channelRef.channel,
    ok: false,
    error: redactHostedEvidence(message, redactions),
    channelRefId: channelRef.id,
    provider: channelRef.service,
    targetRef: null,
    targetRefHash: channelRef.targetRef ? sha256(channelRef.targetRef) : null,
    requestHash: null,
    redacted: true,
  };
}

function hostedChannelsForWorkspace(catalog: HostedReportChannelRefCatalog, workspaceId: string, channelRefIds: string[]): HostedReportChannelRef[] {
  const normalizedWorkspaceId = normalizeSafeRef(workspaceId, "workspaceId");
  const selectedIds = normalizeSelectedChannelRefIds(channelRefIds);
  const enabled = catalog.channels.filter((channel) => channel.enabled !== false);
  const unscoped = enabled.filter((channel) => !channel.workspaceId);
  if (unscoped.length > 0) {
    throw new Error("hosted report delivery requires every enabled channel ref to be scoped to the active workspace");
  }
  const otherWorkspace = enabled.filter((channel) => channel.workspaceId !== normalizedWorkspaceId);
  if (otherWorkspace.length > 0) {
    throw new Error("hosted report delivery catalog contains enabled refs for another workspace");
  }
  const byId = new Map(enabled.filter((channel) => channel.workspaceId === normalizedWorkspaceId).map((channel) => [channel.id, channel]));
  const missing = selectedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error("hosted report delivery selected channel refs must be enabled and scoped to the active workspace");
  return selectedIds.map((id) => byId.get(id)!);
}

function normalizeSelectedChannelRefIds(value: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("hosted report delivery requires explicit selected channel ref ids");
  }
  const ids = value.map((item, index) => normalizeSafeRef(item, `channelRefIds[${index}]`));
  if (new Set(ids).size !== ids.length) throw new Error("hosted report delivery selected channel ref ids must be unique");
  return ids;
}

function parseHostedReportChannelSecretPayload(value: string | Record<string, unknown>, channelRef: HostedReportChannelRef): HostedReportChannelSecretPayload {
  const payload = typeof value === "string" ? parseSecretPayloadJson(value) : value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("hosted report channel secret payload must be a JSON object");
  }
  const record = payload as Record<string, unknown>;
  if (record.version !== "open-uptime.report-channel-secret.v1") {
    throw new Error("hosted report channel secret payload version must be open-uptime.report-channel-secret.v1");
  }
  if (record.service !== "mailery" && record.service !== "telephony" && record.service !== "logs") {
    throw new Error("hosted report channel secret payload service must be mailery, telephony, or logs");
  }
  if (record.service !== channelRef.service) {
    throw new Error("hosted report channel secret payload service must match the channel ref");
  }
  validateSecretPayloadKeys(record, channelRef.service);
  const targetRef = record.targetRef === undefined ? undefined : normalizeSafeRef(record.targetRef, "targetRef");
  if (channelRef.targetRef && targetRef && channelRef.targetRef !== targetRef) {
    throw new Error("hosted report channel secret targetRef must match the channel ref");
  }
  const base = {
    version: record.version,
    service: record.service,
    targetRef,
    apiUrl: optionalUrl(record.apiUrl),
  } as HostedReportChannelSecretBase;
  if (record.service === "mailery") {
    return {
      ...base,
      service: "mailery",
      sendKey: requiredSecretString(record.sendKey, "sendKey"),
      from: requiredText(record.from, "from"),
      to: requiredTargets(record.to, "to"),
      subject: optionalText(record.subject, "subject"),
      providerId: optionalText(record.providerId, "providerId"),
    };
  }
  if (record.service === "telephony") {
    return {
      ...base,
      service: "telephony",
      apiKey: optionalSecretString(record.apiKey, "apiKey"),
      from: optionalText(record.from, "from"),
      to: requiredTargets(record.to, "to"),
    };
  }
  return {
    ...base,
    service: "logs",
    apiKey: optionalSecretString(record.apiKey, "apiKey"),
    projectId: optionalText(record.projectId, "projectId"),
    environment: optionalText(record.environment, "environment"),
    serviceName: optionalText(record.serviceName, "serviceName"),
  };
}

function parseSecretPayloadJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Throw the generic message below without including secret payload bytes.
  }
  throw new Error("hosted report channel secret payload must be valid JSON");
}

function validateSecretPayloadKeys(record: Record<string, unknown>, service: HostedReportChannelService): void {
  const common = new Set(["version", "service", "targetRef", "apiUrl"]);
  const serviceKeys: Record<HostedReportChannelService, Set<string>> = {
    mailery: new Set(["sendKey", "from", "to", "subject", "providerId"]),
    telephony: new Set(["apiKey", "from", "to"]),
    logs: new Set(["apiKey", "projectId", "environment", "serviceName"]),
  };
  const allowed = new Set([...common, ...(serviceKeys[service] ?? [])]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`unsupported hosted report channel secret field: ${key}`);
  }
}

function hostedDeliveryRequestHash(report: UptimeReport, channelRef: HostedReportChannelRef, payload: HostedReportChannelSecretPayload): string {
  return sha256(JSON.stringify({
    version: "open-uptime.hosted-report-delivery-request.v1",
    channelRefId: channelRef.id,
    channel: channelRef.channel,
    provider: channelRef.service,
    targetRef: channelRef.targetRef ?? payload.targetRef ?? null,
    report: report.json,
    destination: safeDestinationFingerprint(payload),
  }));
}

function safeDestinationFingerprint(payload: HostedReportChannelSecretPayload): Record<string, unknown> {
  if (payload.service === "mailery") {
    return {
      service: payload.service,
      apiUrl: payload.apiUrl ?? DEFAULT_MAILERY_API_URL,
      fromHash: sha256(payload.from.toLowerCase()),
      toHash: splitTargets(payload.to).map((target) => sha256(target.toLowerCase())),
      providerId: payload.providerId ?? null,
    };
  }
  if (payload.service === "telephony") {
    return {
      service: payload.service,
      apiUrl: payload.apiUrl ?? DEFAULT_TELEPHONY_API_URL,
      fromHash: payload.from ? sha256(payload.from) : null,
      toHash: splitTargets(payload.to).map((target) => sha256(target)),
    };
  }
  return {
    service: payload.service,
    apiUrl: payload.apiUrl ?? DEFAULT_LOGS_API_URL,
    projectId: payload.projectId ?? "open-uptime",
    environment: payload.environment ?? null,
    serviceName: payload.serviceName ?? "open-uptime",
  };
}

function redactSummaryTargets(summary: UptimeSummary): UptimeSummary {
  return {
    ...summary,
    monitors: summary.monitors.map((item) => ({
      ...item,
      monitor: {
        ...item.monitor,
        name: item.monitor.name,
        url: item.monitor.url ? "[REDACTED_TARGET]" : null,
        host: item.monitor.host ? "[REDACTED_TARGET]" : null,
        port: item.monitor.port == null ? null : 0,
      },
      openIncident: item.openIncident
        ? { ...item.openIncident, reason: redactTargetLikeText(item.openIncident.reason) }
        : item.openIncident,
    })),
  };
}

function redactTargetLikeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi, "[REDACTED_TARGET]")
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi, "[REDACTED_TARGET]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_TARGET]");
}

function hostedRefRedactions(channelRef: HostedReportChannelRef): string[] {
  return [
    channelRef.id,
    channelRef.secretRef,
    channelRef.targetRef,
    channelRef.workspaceId,
  ].filter((value): value is string => Boolean(value));
}

function hostedDeliveryRedactions(channelRef: HostedReportChannelRef, payload: HostedReportChannelSecretPayload): string[] {
  return [
    ...hostedRefRedactions(channelRef),
    payload.targetRef,
    payload.apiUrl,
    ...(payload.service === "mailery" ? [payload.sendKey, payload.from, ...splitTargets(payload.to), payload.providerId] : []),
    ...(payload.service === "telephony" ? [payload.apiKey, payload.from, ...splitTargets(payload.to)] : []),
    ...(payload.service === "logs" ? [payload.apiKey, payload.projectId, payload.environment, payload.serviceName] : []),
  ].filter((value): value is string => Boolean(value));
}

function redactHostedEvidence(value: string, redactions: string[] = []): string {
  return redactSecrets(value, redactions)
    .replace(/arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@:-]+/gi, "[REDACTED_SECRET_REF]")
    .replace(/arn:aws[a-z-]*:ssm:[a-z0-9-]+:\d{12}:parameter\/[A-Za-z0-9/_+=.@:-]+/gi, "[REDACTED_SECRET_REF]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d .()_-]{6,}\d/g, "[REDACTED_PHONE]");
}

function requiredTargets(value: unknown, label: string): string | string[] {
  if (typeof value === "string") {
    if (splitTargets(value).length > 0) return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string") && splitTargets(value).length > 0) {
    return value as string[];
  }
  throw new Error(`${label} must contain at least one destination in the server-owned secret payload`);
}

function requiredText(value: unknown, label: string): string {
  const normalized = optionalText(value, label);
  if (!normalized) throw new Error(`${label} is required in the server-owned secret payload`);
  return normalized;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (/[\x00-\x1f\x7f-\x9f]/.test(normalized)) throw new Error(`${label} must not contain control characters`);
  if (normalized.length > 500) throw new Error(`${label} is too long`);
  return normalized;
}

function requiredSecretString(value: unknown, label: string): string {
  const normalized = optionalSecretString(value, label);
  if (!normalized) throw new Error(`${label} is required in the server-owned secret payload`);
  return normalized;
}

function optionalSecretString(value: unknown, label: string): string | undefined {
  const normalized = optionalText(value, label);
  if (!normalized) return undefined;
  if (normalized.length < 6) throw new Error(`${label} is too short`);
  return normalized;
}

function optionalUrl(value: unknown): string | undefined {
  const normalized = optionalText(value, "apiUrl");
  return normalized ? normalizeUrl(normalized) : undefined;
}

function normalizeSafeRef(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(normalized)) throw new Error(`${label} must use a safe ref id`);
  if (/token|secret|password|api[_-]?key|credential|bearer|jwt/i.test(normalized)) throw new Error(`${label} must not look like secret material`);
  return normalized;
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
      _open_logs_event_id: `open-uptime:report:${report.generatedAt}`,
      report: report.json,
    },
  }, fetchImpl, timeoutMs, secretsForTarget(target));
}

async function sendReportSafely(
  channel: UptimeReportDelivery["channel"],
  target: UptimeEmailReportTarget | UptimeSmsReportTarget | UptimeLogsReportTarget,
  action: () => Promise<UptimeReportDelivery>,
): Promise<UptimeReportDelivery> {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { channel, ok: false, error: redactSecrets(message, secretsForTarget(target)) };
  }
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
  if (parsed.username || parsed.password) {
    throw new Error("Integration API URL must not include username or password");
  }
  for (const key of parsed.searchParams.keys()) {
    if (isSecretUrlParamName(key)) {
      throw new Error("Integration API URL must not include secret query parameters");
    }
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
  return [...values];
}

function redactSecrets(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length >= 3) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/:]+):([^@\s/]*)@/gi, "$1[REDACTED]:[REDACTED]@")
    .replace(/([?&])([^=\s&#?]+)=([^&#\s]*)/gi, (match, prefix: string, key: string) =>
      isSecretUrlParamName(key) ? `${prefix}${key}=[REDACTED]` : match)
    .replace(/\b([A-Za-z0-9_.-]+)=([^\s&#]+)/gi, (match, key: string) =>
      isSecretUrlParamName(key) ? `${key}=[REDACTED]` : match)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\besk_[A-Za-z0-9._~+/=-]+/g, "esk_[REDACTED]");
}

function isSecretUrlParamName(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (SECRET_URL_PARAM_EXACT_NAMES.has(normalized)) return true;
  return SECRET_URL_PARAM_PATTERN.test(normalized);
}

function redactOptional(value: string | undefined, secrets: string[]): string | undefined {
  return value === undefined ? undefined : redactSecrets(value, secrets);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
