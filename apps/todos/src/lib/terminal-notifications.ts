import {
  loadConfig,
  saveConfig,
  type TerminalNotificationFormat,
  type TerminalNotificationRuleConfig,
  type TerminalNotificationSeverity,
} from "./config.js";
import { LOCAL_EVENT_TYPES, type LocalEventType } from "./event-hooks.js";
import { redactValue } from "./redaction.js";

export interface TerminalNotificationRuleInput {
  name: string;
  events: string[];
  enabled?: boolean;
  min_severity?: TerminalNotificationSeverity;
  format?: TerminalNotificationFormat;
  bell?: boolean;
  task_statuses?: string[];
  priorities?: string[];
  agent_ids?: string[];
  project_ids?: string[];
  contains?: string[];
}

export interface TerminalWatchEventInput {
  type: LocalEventType;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

export interface TerminalNotification {
  rule: string;
  event_type: LocalEventType;
  severity: TerminalNotificationSeverity;
  title: string;
  message: string;
  timestamp: string;
  task_id?: string;
  project_id?: string;
  agent_id?: string;
  bell: boolean;
  payload: Record<string, unknown>;
}

export interface TerminalNotificationEvaluation {
  rule: string;
  matched: boolean;
  skipped_reasons: string[];
  notifications: TerminalNotification[];
}

const SEVERITY_ORDER: Record<TerminalNotificationSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const EVENT_SEVERITY: Array<[RegExp, TerminalNotificationSeverity]> = [
  [/(failed|blocked|breach|expired|rejected|cancelled)/, "critical"],
  [/(assigned|status_changed|unblocked|approval|due|deadline|updated)/, "warning"],
];

const VALID_SEVERITIES = new Set<TerminalNotificationSeverity>(["info", "warning", "critical"]);
const VALID_FORMATS = new Set<TerminalNotificationFormat>(["line", "json"]);

function safeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("terminal notification rule name is required");
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) throw new Error("terminal notification rule name may only contain letters, numbers, dot, underscore, or dash");
  return trimmed;
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  const normalized = values?.map((value) => value.trim()).filter(Boolean);
  return normalized && normalized.length > 0 ? Array.from(new Set(normalized)).sort() : undefined;
}

function normalizeEvents(events: string[]): string[] {
  const normalized = normalizeList(events);
  if (!normalized) throw new Error("terminal notification rule requires at least one event");
  return normalized;
}

function normalizeRule(input: TerminalNotificationRuleInput, existing?: TerminalNotificationRuleConfig): TerminalNotificationRuleConfig {
  const severity = input.min_severity || existing?.min_severity || "info";
  const format = input.format || existing?.format || "line";
  if (!VALID_SEVERITIES.has(severity)) throw new Error(`unsupported terminal notification severity: ${severity}`);
  if (!VALID_FORMATS.has(format)) throw new Error(`unsupported terminal notification format: ${format}`);
  const timestamp = new Date().toISOString();
  return {
    ...existing,
    name: safeName(input.name),
    enabled: input.enabled ?? existing?.enabled ?? true,
    events: normalizeEvents(input.events.length > 0 ? input.events : existing?.events || []),
    min_severity: severity,
    format,
    bell: input.bell ?? existing?.bell ?? severity === "critical",
    task_statuses: normalizeList(input.task_statuses) ?? existing?.task_statuses,
    priorities: normalizeList(input.priorities) ?? existing?.priorities,
    agent_ids: normalizeList(input.agent_ids) ?? existing?.agent_ids,
    project_ids: normalizeList(input.project_ids) ?? existing?.project_ids,
    contains: normalizeList(input.contains) ?? existing?.contains,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
}

function eventSeverity(eventType: LocalEventType): TerminalNotificationSeverity {
  for (const [pattern, severity] of EVENT_SEVERITY) {
    if (pattern.test(eventType)) return severity;
  }
  return "info";
}

function payloadText(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).toLowerCase();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fieldMatches(allowed: string[] | undefined, value: unknown): boolean {
  if (!allowed || allowed.length === 0) return true;
  const stringValue = asString(value);
  return Boolean(stringValue && allowed.includes(stringValue));
}

function containsMatches(needles: string[] | undefined, payload: Record<string, unknown>): boolean {
  if (!needles || needles.length === 0) return true;
  const haystack = payloadText(payload);
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function knownEventDescription(rule: TerminalNotificationRuleConfig): string[] {
  return rule.events.filter((event) => event !== "*" && !LOCAL_EVENT_TYPES.includes(event as any));
}

export function upsertTerminalNotificationRule(input: TerminalNotificationRuleInput): TerminalNotificationRuleConfig {
  const config = loadConfig();
  const existing = config.terminal_notification_rules?.[input.name];
  const rule = normalizeRule(input, existing);
  saveConfig({
    ...config,
    terminal_notification_rules: {
      ...(config.terminal_notification_rules || {}),
      [rule.name]: rule,
    },
  });
  return rule;
}

export function listTerminalNotificationRules(): TerminalNotificationRuleConfig[] {
  return Object.values(loadConfig().terminal_notification_rules || {}).sort((a, b) => a.name.localeCompare(b.name));
}

export function getTerminalNotificationRule(name: string): TerminalNotificationRuleConfig | null {
  return loadConfig().terminal_notification_rules?.[safeName(name)] || null;
}

export function removeTerminalNotificationRule(name: string): boolean {
  const config = loadConfig();
  const key = safeName(name);
  if (!config.terminal_notification_rules?.[key]) return false;
  const next = { ...config.terminal_notification_rules };
  delete next[key];
  saveConfig({ ...config, terminal_notification_rules: next });
  return true;
}

export function evaluateTerminalWatchRules(input: TerminalWatchEventInput, rules = listTerminalNotificationRules()): TerminalNotificationEvaluation[] {
  const timestamp = input.timestamp || new Date().toISOString();
  const payload = redactValue(input.payload || {}) as Record<string, unknown>;
  return rules.map((rule) => {
    const skipped: string[] = [];
    const severity = eventSeverity(input.type);
    if (rule.enabled === false) skipped.push("rule disabled");
    if (!rule.events.includes("*") && !rule.events.includes(input.type)) skipped.push("event does not match rule");
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[rule.min_severity]) skipped.push("event severity below rule minimum");
    if (!fieldMatches(rule.task_statuses, payload["status"] ?? payload["new_status"])) skipped.push("task status does not match rule");
    if (!fieldMatches(rule.priorities, payload["priority"])) skipped.push("priority does not match rule");
    if (!fieldMatches(rule.agent_ids, payload["agent_id"] ?? payload["assigned_to"])) skipped.push("agent does not match rule");
    if (!fieldMatches(rule.project_ids, payload["project_id"])) skipped.push("project does not match rule");
    if (!containsMatches(rule.contains, payload)) skipped.push("payload text does not match rule");

    const matched = skipped.length === 0;
    const title = asString(payload["title"]) || asString(payload["name"]) || input.type;
    const taskId = asString(payload["id"]) || asString(payload["task_id"]);
    const notification: TerminalNotification = {
      rule: rule.name,
      event_type: input.type,
      severity,
      title,
      message: `${input.type}: ${title}`,
      timestamp,
      task_id: taskId,
      project_id: asString(payload["project_id"]),
      agent_id: asString(payload["agent_id"]) || asString(payload["assigned_to"]),
      bell: rule.bell && severity === "critical",
      payload,
    };
    return {
      rule: rule.name,
      matched,
      skipped_reasons: skipped,
      notifications: matched ? [notification] : [],
    };
  });
}

export function testTerminalNotificationRule(name: string, input: TerminalWatchEventInput): TerminalNotificationEvaluation {
  const rule = getTerminalNotificationRule(name);
  if (!rule) throw new Error(`terminal notification rule not found: ${name}`);
  return evaluateTerminalWatchRules(input, [rule])[0]!;
}

export function renderTerminalNotification(notification: TerminalNotification, format: TerminalNotificationFormat = "line"): string {
  if (format === "json") return JSON.stringify(notification);
  const id = notification.task_id ? ` ${notification.task_id.slice(0, 8)}` : "";
  const agent = notification.agent_id ? ` [${notification.agent_id}]` : "";
  const prefix = notification.bell ? "\x07" : "";
  return `${prefix}${notification.timestamp} ${notification.severity.toUpperCase()} ${notification.event_type}${id}${agent} ${notification.title}`;
}

export function describeTerminalNotificationRule(rule: TerminalNotificationRuleConfig): { rule: TerminalNotificationRuleConfig; warnings: string[] } {
  const unknown = knownEventDescription(rule);
  return {
    rule,
    warnings: unknown.length > 0 ? [`unknown event names are allowed for custom local events: ${unknown.join(", ")}`] : [],
  };
}
