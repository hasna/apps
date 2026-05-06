import type { Database } from "bun:sqlite";
import type { Agent } from "../types/index.js";
import { now } from "./database.js";

export class InvalidAgentNameError extends Error {
  readonly suggestions: string[];

  constructor(name: string, reason: string, suggestions: string[] = []) {
    super(`Invalid agent name "${name}": ${reason}${suggestions.length > 0 ? `. Try: ${suggestions.join(", ")}` : ""}`);
    this.name = "InvalidAgentNameError";
    this.suggestions = suggestions;
  }
}

export const ROMAN_AGENT_NAMES = [
  "caesar",
  "augustus",
  "marcus",
  "brutus",
  "cicero",
  "cato",
  "nero",
  "claudius",
  "tiberius",
  "hadrian",
  "trajan",
  "vespasian",
  "domitian",
  "caligula",
  "commodus",
  "livia",
  "julia",
  "octavia",
  "claudia",
  "agrippina",
  "cornelia",
  "valeria",
  "fulvia",
  "hortensia",
  "fabia",
] as const;

export const GREEK_AGENT_NAMES = [
  "athena",
  "apollo",
  "artemis",
  "hera",
  "iris",
  "hector",
  "achilles",
  "odysseus",
  "theseus",
  "pericles",
  "solon",
  "sophia",
  "thalia",
  "calliope",
  "clio",
  "phoebe",
  "daphne",
  "leonidas",
  "andromeda",
  "cassander",
] as const;

export const NICE_AGENT_NAMES = [
  "atlas",
  "aurora",
  "ember",
  "nova",
  "orion",
  "rhea",
  "selene",
  "sirius",
  "vesper",
  "zephyr",
] as const;

export const PREFERRED_AGENT_NAMES = [
  ...ROMAN_AGENT_NAMES,
  ...GREEK_AGENT_NAMES,
  ...NICE_AGENT_NAMES,
] as const;

const RESERVED_GENERIC_NAMES = new Set([
  "agent",
  "agents",
  "ai",
  "assistant",
  "bot",
  "coder",
  "default",
  "helper",
  "model",
  "system",
  "user",
  "worker",
]);

const NUMERIC_SUFFIX_RE = /[-_]\d+$/;
const ONE_WORD_NAME_RE = /^[a-z]+$/;

export function normalizeAgentNameInput(name: string): string {
  return name.trim().toLowerCase();
}

export function hasGeneratedNumericSuffix(name: string): boolean {
  return NUMERIC_SUFFIX_RE.test(normalizeAgentNameInput(name));
}

export function isGenericAgentName(name: string): boolean {
  const normalized = normalizeAgentNameInput(name);
  if (RESERVED_GENERIC_NAMES.has(normalized)) return true;
  for (const generic of RESERVED_GENERIC_NAMES) {
    if (normalized === `${generic}s`) return true;
    if (normalized.match(new RegExp(`^${generic}\\d+$`))) return true;
    if (normalized.match(new RegExp(`^${generic}[-_]\\d+$`))) return true;
  }
  return false;
}

export function isBlockedAgentName(name: string): boolean {
  const normalized = normalizeAgentNameInput(name);
  return isGenericAgentName(normalized) || hasGeneratedNumericSuffix(normalized) || !ONE_WORD_NAME_RE.test(normalized);
}

export function suggestAgentNames(existingNames: Iterable<string> = []): string[] {
  const existing = new Set([...existingNames].map(normalizeAgentNameInput));
  return PREFERRED_AGENT_NAMES.filter((name) => !existing.has(name));
}

export function validateAgentName(name: string, existingNames: Iterable<string> = []): string {
  const normalized = normalizeAgentNameInput(name);
  const suggestions = suggestAgentNames(existingNames).slice(0, 5);

  if (!normalized) {
    throw new InvalidAgentNameError(name, "choose a real one-word name instead of an empty value", suggestions);
  }
  if (/\s/.test(normalized)) {
    throw new InvalidAgentNameError(name, "use a single word, preferably a Roman or Greek name", suggestions);
  }
  if (normalized.length < 3) {
    throw new InvalidAgentNameError(name, "use a more distinctive name with at least three characters", suggestions);
  }
  if (isGenericAgentName(normalized)) {
    throw new InvalidAgentNameError(name, "generic names like agent, agent-1, assistant, or worker-2 are reserved", suggestions);
  }
  if (hasGeneratedNumericSuffix(normalized)) {
    throw new InvalidAgentNameError(name, "numbered suffix names are not allowed; pick a distinct human-readable name", suggestions);
  }
  if (!ONE_WORD_NAME_RE.test(normalized)) {
    throw new InvalidAgentNameError(name, "use one word made of letters only, preferably a Roman or Greek name", suggestions);
  }

  return normalized;
}

function tableHasColumn(db: Database, table: string, column: string): boolean {
  try {
    return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((row) => row.name === column);
  } catch {
    return false;
  }
}

function updateReferences(db: Database, oldName: string, newName: string): number {
  const refs: Array<[string, string]> = [
    ["tasks", "assigned_to"],
    ["tasks", "agent_id"],
    ["tasks", "locked_by"],
    ["tasks", "assigned_by"],
    ["plans", "agent_id"],
    ["sessions", "agent_id"],
    ["task_comments", "agent_id"],
    ["task_history", "agent_id"],
    ["webhooks", "agent_id"],
    ["task_files", "agent_id"],
    ["task_time_logs", "agent_id"],
    ["task_watchers", "agent_id"],
    ["task_checkpoints", "agent_id"],
    ["task_heartbeats", "agent_id"],
    ["project_agent_roles", "agent_id"],
  ];

  let changed = 0;
  for (const [table, column] of refs) {
    if (!tableHasColumn(db, table, column)) continue;
    try {
      changed += db.run(`UPDATE ${table} SET ${column} = ? WHERE LOWER(${column}) = ?`, [newName, oldName]).changes;
    } catch {
      // Best-effort reference cleanup; schema may vary across older DBs.
    }
  }
  return changed;
}

export interface AgentNameNormalization {
  id: string;
  old_name: string;
  new_name: string;
  reference_updates: number;
}

export function normalizeGeneratedAgentNames(db: Database): AgentNameNormalization[] {
  const rows = db.query("SELECT * FROM agents ORDER BY created_at, id").all() as Agent[];
  const existing = new Set(rows.map((agent) => normalizeAgentNameInput(agent.name)));
  const renamed: AgentNameNormalization[] = [];

  for (const agent of rows) {
    const oldName = normalizeAgentNameInput(agent.name);
    if (!isBlockedAgentName(oldName)) continue;

    const candidates = suggestAgentNames(existing);
    const replacement = candidates[0];
    if (!replacement) {
      throw new Error("No safe agent names are available for normalization");
    }

    existing.delete(oldName);
    existing.add(replacement);

    db.run("UPDATE agents SET name = ?, last_seen_at = ? WHERE id = ?", [replacement, now(), agent.id]);
    const referenceUpdates = updateReferences(db, oldName, replacement);
    renamed.push({
      id: agent.id,
      old_name: oldName,
      new_name: replacement,
      reference_updates: referenceUpdates,
    });
  }

  return renamed;
}
