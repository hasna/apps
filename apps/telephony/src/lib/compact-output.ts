import type { Agent, Call, Contact, Message, PhoneNumber, Project, Schedule, Voicemail, Webhook } from "../types/index.js";

export const DEFAULT_OUTPUT_LIMIT = 20;
export const MAX_OUTPUT_LIMIT = 100;

export interface CollectionOptions { limit?: number; cursor?: number; verbose?: boolean; total?: number | null }

function limitOf(value: number | undefined): number {
  if (value === undefined) return DEFAULT_OUTPUT_LIMIT;
  if (!Number.isInteger(value) || value <= 0) throw new Error("limit must be a positive integer");
  if (value > MAX_OUTPUT_LIMIT) throw new Error(`limit must be <= ${MAX_OUTPUT_LIMIT}`);
  return value;
}
function cursorOf(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error("cursor must be a non-negative integer");
  return value;
}
export function truncateText(value: string | null | undefined, max = 160): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
export function collectionPage<K extends string, T, U>(key: K, items: T[], options: CollectionOptions, summarize: (item: T) => U) {
  const limit = limitOf(options.limit); const cursor = cursorOf(options.cursor);
  const selected = items.slice(cursor, cursor + limit);
  const nextCursor = cursor + selected.length < items.length ? cursor + selected.length : null;
  return {
    [key]: options.verbose ? selected : selected.map(summarize), count: selected.length, total: items.length,
    limit, cursor, next_cursor: nextCursor, compact: !options.verbose,
    hint: nextCursor === null ? "Set verbose=true for full fields in this page, or full=true for the legacy complete response."
      : `Continue with cursor=${nextCursor}; set verbose=true for full fields in a page, or full=true for the legacy complete response.`,
  } as Record<K, Array<T | U>> & { count:number; total:number; limit:number; cursor:number; next_cursor:number|null; compact:boolean; hint:string };
}
export function windowPage<K extends string, T, U>(key: K, rows: T[], options: CollectionOptions, summarize: (item: T) => U) {
  const limit = limitOf(options.limit); const cursor = cursorOf(options.cursor);
  const selected = rows.slice(0, limit);
  const total = options.total ?? null;
  const hasMore = total === null ? rows.length > limit : cursor + selected.length < total;
  const nextCursor = hasMore ? cursor + selected.length : null;
  return {
    [key]: options.verbose ? selected : selected.map(summarize), count: selected.length, total,
    limit, cursor, next_cursor: nextCursor, has_more: hasMore, compact: !options.verbose,
    hint: hasMore ? `Continue with cursor=${nextCursor}; set verbose=true for full fields in a page, or full=true for the legacy response.`
      : "Set verbose=true for full fields in this page, or full=true for the legacy response.",
  } as Record<K, Array<T | U>> & { count:number; total:number|null; limit:number; cursor:number; next_cursor:number|null; has_more:boolean; compact:boolean; hint:string };
}
export function compactMessage(row: Message) { return { id: row.id, type: row.type, from_number: row.from_number, to_number: row.to_number, body: truncateText(row.body, 160), status: row.status, agent_id: row.agent_id, project_id: row.project_id, created_at: row.created_at }; }
export function compactCall(row: Call) { return { id: row.id, direction: row.direction, from_number: row.from_number, to_number: row.to_number, status: row.status, duration: row.duration, agent_id: row.agent_id, project_id: row.project_id, started_at: row.started_at }; }
export function compactAgent(row: Agent) { return { id: row.id, name: row.name, description: truncateText(row.description, 100), project_id: row.project_id, status: row.status, last_seen_at: row.last_seen_at }; }
export function compactProject(row: Project) { return { id: row.id, name: row.name, path: truncateText(row.path, 120), description: truncateText(row.description, 100) }; }
export function compactPhoneNumber(row: PhoneNumber) { return { id: row.id, number: row.number, country: row.country, capabilities: row.capabilities, agent_id: row.agent_id, project_id: row.project_id, friendly_name: truncateText(row.friendly_name, 80), status: row.status }; }
export function compactVoicemail(row: Voicemail) { return { id: row.id, from_number: row.from_number, to_number: row.to_number, transcription: truncateText(row.transcription, 160), duration: row.duration, listened: row.listened, created_at: row.created_at }; }
export function compactContact(row: Contact) { return { id: row.id, name: row.name, phone: row.phone, email: row.email, agent_id: row.agent_id, project_id: row.project_id, notes: truncateText(row.notes, 100) }; }
export function compactSchedule(row: Schedule) { return { id: row.id, name: row.name, cron_expression: row.cron_expression, action: row.action, command: truncateText(row.command, 120), enabled: row.enabled, agent_id: row.agent_id, project_id: row.project_id }; }
export function compactWebhook(row: Webhook) { return { id: row.id, url: truncateText(row.url, 140), events: row.events, active: row.active, created_at: row.created_at }; }
