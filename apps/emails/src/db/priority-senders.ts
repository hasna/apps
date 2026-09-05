// Priority Inbox sender rules — ONE module for both installations.
//
// WHAT THIS FILE USED TO BE. A 14-line facade that read the deployment word and
// dispatched its three exports to one of two sibling modules: a SQLite arm
// (`priority-senders.local.ts`) and a curl-bridge arm (`priority-senders.remote.ts`).
// Both are gone. The SQLite and self-hosted implementations now live in this single
// file, under distinct names (`*Local` / `*Remote`), and the published surface
// (the plain names) chooses between them by the process-wide store selection at
// call time. The local arms (the TUI local data layer, the local mail data source,
// the local server routes) import the `*Local` implementations directly and never
// ask where this installation is deployed; the remote arm imports the `*Remote`
// implementations; the mode routing exists only at the facade.
import { getDatabase, now, type Database } from "./database.js";
import { selfHostedStoreFor } from "./self-hosted-store.js";
import { ciso, cstr } from "./self-hosted-resource.js";
import { getClientMode } from "../lib/mode.js";
import {
  normalizePriorityRuleInput,
  prioritySenderRuleId,
  type PrioritySenderRule,
  type PrioritySenderRuleKind,
} from "../lib/priority-senders.js";

const RULES_RESOURCE = "priority-sender-rules";

// ---- SQLite implementation (the local installation's store) -----------------
//
// The injectable seam is the database handle: every function accepts an optional
// `Database`, falling back to the process-wide default, so the local server
// routes and the TUI local data layer can share one handle.

function sqliteRowToRule(row: { id: string; kind: string; value: string; created_at?: string | null }): PrioritySenderRule {
  return {
    id: row.id,
    kind: row.kind as PrioritySenderRuleKind,
    value: row.value,
    created_at: row.created_at ?? undefined,
  };
}

export function listPrioritySenderRulesLocal(db?: Database): PrioritySenderRule[] {
  const d = db ?? getDatabase();
  const rows = d.query(
    "SELECT id, kind, value, created_at FROM priority_sender_rules ORDER BY kind ASC, value ASC",
  ).all() as Array<{ id: string; kind: string; value: string; created_at?: string | null }>;
  return rows.map(sqliteRowToRule);
}

export function addPrioritySenderRuleLocal(kind: unknown, value: unknown, db?: Database): PrioritySenderRule {
  const d = db ?? getDatabase();
  const normalized = normalizePriorityRuleInput(kind, value);
  const id = prioritySenderRuleId(normalized.kind, normalized.value);
  d.query(
    `INSERT OR IGNORE INTO priority_sender_rules (id, kind, value, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, normalized.kind, normalized.value, now());
  const row = d.query(
    "SELECT id, kind, value, created_at FROM priority_sender_rules WHERE kind = ? AND value = ?",
  ).get(normalized.kind, normalized.value) as { id: string; kind: string; value: string; created_at?: string | null } | null;
  if (!row) throw new Error("priority sender rule was not persisted");
  return sqliteRowToRule(row);
}

export function removePrioritySenderRuleLocal(id: string, db?: Database): boolean {
  const d = db ?? getDatabase();
  const result = d.query("DELETE FROM priority_sender_rules WHERE id = ?").run(id);
  return result.changes > 0;
}

export function removePrioritySenderRuleByValueLocal(kind: unknown, value: unknown, db?: Database): boolean {
  const d = db ?? getDatabase();
  const normalized = normalizePriorityRuleInput(kind, value);
  const result = d.query("DELETE FROM priority_sender_rules WHERE kind = ? AND value = ?")
    .run(normalized.kind, normalized.value);
  return result.changes > 0;
}

// ---- self-hosted implementation (the operator's /v1 store) ------------------
//
// Synchronous on purpose: the TUI and CLI import the data layer without an
// await, and `selfHostedStoreFor` already performs its HTTP calls synchronously
// through the curl bridge.

function remoteRowToRule(row: Record<string, unknown>): PrioritySenderRule {
  const normalized = normalizePriorityRuleInput(row.kind, row.value);
  return {
    id: cstr(row.id) || prioritySenderRuleId(normalized.kind, normalized.value),
    kind: normalized.kind,
    value: normalized.value,
    created_at: ciso(row.created_at),
  };
}

export function listPrioritySenderRulesRemote(): PrioritySenderRule[] {
  return selfHostedStoreFor(RULES_RESOURCE).list({ limit: 1000 }).map(remoteRowToRule);
}

export function addPrioritySenderRuleRemote(kind: unknown, value: unknown): PrioritySenderRule {
  const normalized = normalizePriorityRuleInput(kind, value);
  return remoteRowToRule(selfHostedStoreFor(RULES_RESOURCE).create({
    id: prioritySenderRuleId(normalized.kind, normalized.value),
    kind: normalized.kind,
    value: normalized.value,
  }));
}

export function removePrioritySenderRuleRemote(id: string): boolean {
  return selfHostedStoreFor(RULES_RESOURCE).del(id);
}

// ---- published surface ------------------------------------------------------
//
// The plain names are what the TUI data facade re-exports and what callers that
// do not know their own installation use. Each call picks the implementation by
// the process-wide store selection, so a mode change mid-process is honored.

function rulesAreRemote(): boolean {
  return getClientMode() === "self_hosted";
}

export function listPrioritySenderRules(db?: Database): PrioritySenderRule[] {
  return rulesAreRemote() ? listPrioritySenderRulesRemote() : listPrioritySenderRulesLocal(db);
}

export function addPrioritySenderRule(kind: unknown, value: unknown, db?: Database): PrioritySenderRule {
  return rulesAreRemote() ? addPrioritySenderRuleRemote(kind, value) : addPrioritySenderRuleLocal(kind, value, db);
}

export function removePrioritySenderRule(id: string, db?: Database): boolean {
  return rulesAreRemote() ? removePrioritySenderRuleRemote(id) : removePrioritySenderRuleLocal(id, db);
}
