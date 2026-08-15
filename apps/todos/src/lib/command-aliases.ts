/**
 * Project-local saved command aliases and natural query shortcuts.
 * Local explicit parsing only — no hosted NLP.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { listTopLevelCommands } from "./cli-reference.js";

export const COMMAND_ALIASES_SCHEMA = "todos.command_aliases.v1";

export interface CommandAlias {
  name: string;
  argv: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AliasStore {
  schema_version: typeof COMMAND_ALIASES_SCHEMA;
  aliases: Record<string, CommandAlias>;
  updated_at: string;
}

export interface QueryResolution {
  schema_version: typeof COMMAND_ALIASES_SCHEMA;
  input: string;
  source: "alias" | "builtin" | "composed" | "passthrough";
  argv: string[];
  explain: string;
  dry_run: boolean;
}

export interface ImportAliasesResult {
  schema_version: typeof COMMAND_ALIASES_SCHEMA;
  imported: number;
  skipped: number;
  conflicts: string[];
}

const RESERVED = new Set([...listTopLevelCommands(), "help", "version", "alias", "shortcuts"]);

interface BuiltinShortcut {
  pattern: RegExp;
  argv: string[];
  explain: string;
}

const BUILTIN_SHORTCUTS: BuiltinShortcut[] = [
  { pattern: /^status$/, argv: ["status"], explain: "Project health snapshot" },
  { pattern: /^next$/, argv: ["next"], explain: "Best pending task to claim" },
  { pattern: /^active$/, argv: ["active"], explain: "In-progress tasks across agents" },
  { pattern: /^stale$/, argv: ["stale"], explain: "Stale or abandoned tasks" },
  { pattern: /^my tasks?$/, argv: ["list", "-s", "in_progress"], explain: "Your in-progress tasks" },
  { pattern: /^pending$/, argv: ["list", "-s", "pending"], explain: "Pending tasks" },
  { pattern: /^pending high$/, argv: ["list", "-s", "pending", "-p", "high"], explain: "High-priority pending tasks" },
  { pattern: /^blocked tasks?$/, argv: ["search", "--blocked"], explain: "Tasks blocked by dependencies" },
  { pattern: /^ready tasks?$/, argv: ["deps", "ready"], explain: "Dependency-ready tasks" },
  { pattern: /^overdue$/, argv: ["list", "--due", "overdue"], explain: "Overdue tasks" },
  { pattern: /^due today$/, argv: ["list", "--due", "today"], explain: "Tasks due today" },
  { pattern: /^runs?$/, argv: ["runs", "list"], explain: "Recent run records" },
  { pattern: /^reports?$/, argv: ["report", "docs"], explain: "Report export documentation" },
];

function aliasesPath(cwd = process.cwd()): string {
  return join(cwd, ".todos", "aliases.json");
}

function emptyStore(): AliasStore {
  return { schema_version: COMMAND_ALIASES_SCHEMA, aliases: {}, updated_at: new Date(0).toISOString() };
}

export function validateAliasName(name: string): { ok: true } | { ok: false; reason: string } {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(normalized)) {
    return { ok: false, reason: "Alias must start with a letter and use lowercase letters, digits, _, -" };
  }
  if (RESERVED.has(normalized)) {
    return { ok: false, reason: `Alias conflicts with reserved command: ${normalized}` };
  }
  return { ok: true };
}

export function loadAliasStore(cwd?: string): AliasStore {
  const path = aliasesPath(cwd);
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as AliasStore;
  if (parsed.schema_version !== COMMAND_ALIASES_SCHEMA) {
    throw new Error(`Unsupported alias store schema: ${parsed.schema_version}`);
  }
  return parsed;
}

export function saveAliasStore(store: AliasStore, cwd?: string): void {
  const path = aliasesPath(cwd);
  mkdirSync(join(path, ".."), { recursive: true });
  store.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
}

function parseArgv(command: string): string[] {
  const argv: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command.trim())) !== null) {
    argv.push(match[1] ?? match[2] ?? match[3]!);
  }
  return argv;
}

export function listCommandAliases(cwd?: string): CommandAlias[] {
  const store = loadAliasStore(cwd);
  return Object.values(store.aliases).sort((a, b) => a.name.localeCompare(b.name));
}

export function getCommandAlias(name: string, cwd?: string): CommandAlias | null {
  const store = loadAliasStore(cwd);
  return store.aliases[name.trim().toLowerCase()] ?? null;
}

export function saveCommandAlias(
  input: { name: string; command: string; description?: string },
  cwd?: string,
): CommandAlias {
  const name = input.name.trim().toLowerCase();
  const check = validateAliasName(name);
  if (!check.ok) throw new Error(check.reason);

  const argv = parseArgv(input.command);
  if (!argv.length) throw new Error("Alias command cannot be empty");

  const store = loadAliasStore(cwd);
  const ts = new Date().toISOString();
  const existing = store.aliases[name];
  const alias: CommandAlias = {
    name,
    argv,
    description: input.description ?? existing?.description ?? null,
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };
  store.aliases[name] = alias;
  saveAliasStore(store, cwd);
  return alias;
}

export function deleteCommandAlias(name: string, cwd?: string): boolean {
  const store = loadAliasStore(cwd);
  const key = name.trim().toLowerCase();
  if (!store.aliases[key]) return false;
  delete store.aliases[key];
  saveAliasStore(store, cwd);
  return true;
}

function composeFromKeywords(query: string): QueryResolution | null {
  const tokens = query.trim().toLowerCase().split(/\s+/);
  if (!tokens.length || tokens[0] === "todos") return null;

  const argv = ["list"];
  const parts: string[] = [];

  if (tokens.includes("pending")) {
    argv.push("-s", "pending");
    parts.push("status=pending");
  } else if (tokens.includes("progress") || tokens.includes("active")) {
    argv.push("-s", "in_progress");
    parts.push("status=in_progress");
  } else if (tokens.includes("done") || tokens.includes("completed")) {
    argv.push("-s", "completed");
    parts.push("status=completed");
  }

  const priority = tokens.find((t) => ["low", "medium", "high", "urgent"].includes(t));
  if (priority) {
    argv.push("-p", priority);
    parts.push(`priority=${priority}`);
  }

  if (tokens.includes("blocked")) {
    return {
      schema_version: COMMAND_ALIASES_SCHEMA,
      input: query,
      source: "composed",
      argv: ["search", "--blocked"],
      explain: "Composed shortcut: blocked tasks",
      dry_run: true,
    };
  }

  if (parts.length === 0) return null;

  return {
    schema_version: COMMAND_ALIASES_SCHEMA,
    input: query,
    source: "composed",
    argv,
    explain: `Composed list filter: ${parts.join(", ")}`,
    dry_run: true,
  };
}

export function resolveCommandQuery(input: string, options: { dry_run?: boolean } = {}, cwd?: string): QueryResolution {
  const trimmed = input.trim();
  const dryRun = options.dry_run !== false;

  if (trimmed.startsWith("@")) {
    const alias = getCommandAlias(trimmed.slice(1), cwd);
    if (!alias) throw new Error(`Unknown alias: ${trimmed.slice(1)}`);
    return {
      schema_version: COMMAND_ALIASES_SCHEMA,
      input: trimmed,
      source: "alias",
      argv: [...alias.argv],
      explain: alias.description ?? `Saved alias @${alias.name}`,
      dry_run: dryRun,
    };
  }

  const lower = trimmed.toLowerCase();
  for (const shortcut of BUILTIN_SHORTCUTS) {
    if (shortcut.pattern.test(lower)) {
      return {
        schema_version: COMMAND_ALIASES_SCHEMA,
        input: trimmed,
        source: "builtin",
        argv: [...shortcut.argv],
        explain: shortcut.explain,
        dry_run: dryRun,
      };
    }
  }

  const composed = composeFromKeywords(trimmed);
  if (composed) return { ...composed, dry_run: dryRun };

  const argv = parseArgv(trimmed);
  return {
    schema_version: COMMAND_ALIASES_SCHEMA,
    input: trimmed,
    source: "passthrough",
    argv,
    explain: "Passthrough argv (no shortcut matched)",
    dry_run: dryRun,
  };
}

export function explainCommandQuery(input: string, cwd?: string): string {
  const resolution = resolveCommandQuery(input, { dry_run: true }, cwd);
  const lines = [
    `Input: ${resolution.input}`,
    `Source: ${resolution.source}`,
    `Explain: ${resolution.explain}`,
    `Argv: todos ${resolution.argv.join(" ")}`,
  ];
  return lines.join("\n");
}

export function exportCommandAliases(cwd?: string): AliasStore {
  return loadAliasStore(cwd);
}

export function importCommandAliases(
  payload: AliasStore,
  strategy: "skip" | "overwrite" = "skip",
  cwd?: string,
): ImportAliasesResult {
  if (payload.schema_version !== COMMAND_ALIASES_SCHEMA) {
    throw new Error(`Unsupported import schema: ${payload.schema_version}`);
  }

  const store = loadAliasStore(cwd);
  const conflicts: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (const alias of Object.values(payload.aliases)) {
    const check = validateAliasName(alias.name);
    if (!check.ok) {
      skipped++;
      conflicts.push(`${alias.name}: ${check.reason}`);
      continue;
    }
    if (store.aliases[alias.name] && strategy === "skip") {
      skipped++;
      conflicts.push(alias.name);
      continue;
    }
    store.aliases[alias.name] = alias;
    imported++;
  }

  saveAliasStore(store, cwd);
  return { schema_version: COMMAND_ALIASES_SCHEMA, imported, skipped, conflicts };
}

export function getCommandAliasDocs(): string {
  return `# Command aliases and query shortcuts

Project-local aliases live in \`.todos/aliases.json\`.

## Examples
\`\`\`bash
todos shortcuts add ship "done \$1 --notes shipped"
todos shortcuts explain "pending high"
todos shortcuts explain @ship
todos shortcuts run "due today"
\`\`\`

Built-in shortcuts include: status, next, active, stale, pending high, blocked tasks, ready tasks, overdue, due today.
`;
}

export function listBuiltinShortcuts(): Array<{ pattern: string; argv: string[]; explain: string }> {
  return BUILTIN_SHORTCUTS.map((s) => ({
    pattern: s.pattern.source,
    argv: s.argv,
    explain: s.explain,
  }));
}
