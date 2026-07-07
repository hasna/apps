import { basename } from "node:path";
import { homedir } from "node:os";
import type { Loop, ScheduleSpec } from "../types.js";
import type { Store } from "./store.js";

export interface NameHygieneChange {
  id: string;
  status: string;
  scope: "machine" | "repo";
  scopeSlug: string;
  oldName: string;
  newName: string;
  changed: boolean;
}

export interface NameHygieneReport {
  ok: boolean;
  generatedAt: string;
  applied: boolean;
  checked: number;
  changed: number;
  changes: NameHygieneChange[];
  conflicts: NameHygieneChange[];
}

export interface DuplicateOverlapGroup {
  key: string;
  baseName: string;
  cwd?: string;
  schedule: string;
  loops: Array<Pick<Loop, "id" | "name" | "status" | "nextRunAt">>;
}

export interface DuplicateOverlapReport {
  ok: boolean;
  generatedAt: string;
  checked: number;
  groups: DuplicateOverlapGroup[];
}

export interface ScriptBackedLoop {
  id: string;
  name: string;
  status: string;
  cwd?: string;
  command: string;
  scriptMatches: string[];
}

export interface ScriptInventoryReport {
  ok: boolean;
  generatedAt: string;
  checked: number;
  scriptBacked: number;
  loops: ScriptBackedLoop[];
}

const PROVIDER_TOKENS = new Set([
  "codewith",
  "claude",
  "command",
  "tmux",
  "codex",
  "cursor",
  "opencode",
  "aicopilot",
  "agent",
]);
const REPO_GENERIC_TOKENS = new Set(["repo", "repoops"]);
const CADENCE_SUFFIX_TOKENS = new Set(["hourly", "daily", "weekly", "monthly"]);
const CADENCE_SUFFIX_PATTERN = /^(?:every-?)?\d+(?:s|m|h|d|w)$/;

function userHome(): string {
  return process.env.HOME || homedir();
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "-")
    .replace(/[_\s.:/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function repoSlugFromCwd(cwd: string | undefined): string {
  if (!cwd || cwd === userHome()) return "";
  const home = userHome().replace(/\/+$/g, "");
  const normalized = cwd.replace(/\/+$/g, "");
  const loopsDataDir = `${home}/.hasna/loops`;
  if (normalized === loopsDataDir) return "";
  if (normalized.startsWith(`${loopsDataDir}/`) && !normalized.startsWith(`${loopsDataDir}/worktrees/`)) return "";
  return slugify(basename(cwd));
}

function scopeForLoop(loop: Loop): { scope: "machine" | "repo"; prefix: string; scopeSlug: string } {
  const cwd = loop.target.type === "command" || loop.target.type === "agent" ? loop.target.cwd : undefined;
  const repoSlug = repoSlugFromCwd(cwd);
  if (repoSlug) return { scope: "repo", prefix: `repo-${repoSlug}`, scopeSlug: repoSlug };
  return { scope: "machine", prefix: "machine", scopeSlug: "machine" };
}

function taskSlug(loop: Loop, scope: ReturnType<typeof scopeForLoop>): string {
  const oldName = loop.name;
  let nameForParsing = oldName;
  if (!oldName.includes(":")) {
    const slug = slugify(oldName);
    if (scope.scope === "machine" && slug.startsWith("machine-")) nameForParsing = slug.slice("machine-".length);
    else if (scope.scope === "repo" && slug.startsWith(`repo-${scope.scopeSlug}-`)) {
      nameForParsing = slug.slice(`repo-${scope.scopeSlug}-`.length);
    } else nameForParsing = slug;
  }

  const parts: string[] = [];
  for (const rawPart of oldName.includes(":") ? oldName.split(":") : [nameForParsing]) {
    const part = slugify(rawPart);
    if (!part) continue;
    if (PROVIDER_TOKENS.has(part) || /^account\d+$/.test(part)) continue;
    if (scope.scope === "repo" && REPO_GENERIC_TOKENS.has(part)) continue;

    let normalized = part;
    if (scope.scope === "repo" && normalized === scope.scopeSlug) continue;
    if (scope.scope === "repo" && normalized.startsWith(`${scope.scopeSlug}-`)) {
      normalized = normalized.slice(scope.scopeSlug.length + 1);
    }
    if (normalized) parts.push(normalized);
  }

  const deduped: string[] = [];
  for (const token of parts.join("-").split("-").filter(Boolean)) {
    if (deduped[deduped.length - 1] !== token) deduped.push(token);
  }
  while (deduped.length) {
    const last = deduped[deduped.length - 1];
    if (CADENCE_SUFFIX_TOKENS.has(last) || CADENCE_SUFFIX_PATTERN.test(last)) {
      deduped.pop();
      if (deduped[deduped.length - 1] === "every") deduped.pop();
      continue;
    }
    break;
  }
  return deduped.join("-") || "loop";
}

function canonicalName(loop: Loop): Omit<NameHygieneChange, "oldName" | "changed"> {
  const scope = scopeForLoop(loop);
  let name = `${scope.prefix}-${taskSlug(loop, scope)}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (name.length > 120) name = `${name.slice(0, 111).replace(/-+$/g, "")}-${loop.id.slice(0, 8)}`;
  return {
    id: loop.id,
    status: loop.status,
    scope: scope.scope,
    scopeSlug: scope.scopeSlug,
    newName: name,
  };
}

function ensureUnique(changes: NameHygieneChange[], existingNames: Iterable<string> = []): void {
  const oldNames = new Set(changes.map((change) => change.oldName));
  const used = new Set([...existingNames].filter((name) => !oldNames.has(name)));
  for (const change of changes) {
    let candidate = change.newName;
    if (!used.has(candidate)) {
      used.add(candidate);
      change.newName = candidate;
      change.changed = change.oldName !== candidate;
      continue;
    }
    const base = candidate.slice(0, 111).replace(/-+$/g, "");
    candidate = `${base}-${change.id.slice(0, 8)}`;
    let suffix = 2;
    while (used.has(candidate)) {
      const extra = `-${change.id.slice(0, 6)}-${suffix++}`;
      candidate = `${base.slice(0, 120 - extra.length)}${extra}`;
    }
    used.add(candidate);
    change.newName = candidate;
    change.changed = change.oldName !== candidate;
  }
}

function managedLoops(store: Store, opts: { includeStopped?: boolean; includeInactive?: boolean; limit?: number }): Loop[] {
  const loops = store.listLoops({ includeArchived: Boolean(opts.includeInactive), limit: opts.limit ?? 1_000 });
  if (opts.includeInactive) return loops;
  if (opts.includeStopped) return loops.filter((loop) => loop.status !== "expired");
  return loops.filter((loop) => loop.status === "active" || loop.status === "paused");
}

export function buildNameHygieneReport(
  store: Store,
  opts: { apply?: boolean; includeStopped?: boolean; includeInactive?: boolean; limit?: number } = {},
): NameHygieneReport {
  const allLoops = store.listLoops({ includeArchived: true, limit: 10_000 });
  const changes = managedLoops(store, opts).map((loop) => {
    const canonical = canonicalName(loop);
    return {
      ...canonical,
      oldName: loop.name,
      changed: loop.name !== canonical.newName,
    };
  });
  ensureUnique(changes, allLoops.map((loop) => loop.name));
  const changed = changes.filter((change) => change.changed);
  const conflicts = changes.filter((change) => allLoops.some((loop) => loop.name === change.newName && loop.id !== change.id));
  if (opts.apply) {
    for (const change of changed) store.renameLoop(change.id, change.newName);
  }
  return {
    ok: changed.length === 0,
    generatedAt: new Date().toISOString(),
    applied: Boolean(opts.apply),
    checked: changes.length,
    changed: changed.length,
    changes,
    conflicts,
  };
}

function baseName(name: string): string {
  return name
    .replace(/-(bounded|compact|native)?-?low(?:-\d+m)?$/g, "")
    .replace(/-\d+[mhd]$/g, "")
    .replace(/-(bounded|compact)$/g, "");
}

function scheduleKey(schedule: ScheduleSpec): string {
  if (schedule.type === "cron") return `cron:${schedule.expression}`;
  if (schedule.type === "interval") return `interval:${schedule.everyMs}`;
  if (schedule.type === "once") return `once:${schedule.at}`;
  return `dynamic:${schedule.minIntervalMs ?? ""}`;
}

function targetCwd(loop: Loop): string {
  return loop.target.type === "command" || loop.target.type === "agent" ? loop.target.cwd ?? "" : "";
}

export function buildDuplicateOverlapReport(
  store: Store,
  opts: { includeInactive?: boolean; limit?: number } = {},
): DuplicateOverlapReport {
  const loops = managedLoops(store, { includeInactive: opts.includeInactive, includeStopped: true, limit: opts.limit });
  const groups = new Map<string, { baseName: string; cwd?: string; schedule: string; loops: Loop[] }>();
  for (const loop of loops) {
    const base = baseName(loop.name);
    const cwd = targetCwd(loop) || undefined;
    const schedule = scheduleKey(loop.schedule);
    const key = `${base}|${cwd ?? ""}|${schedule}`;
    const existing = groups.get(key) ?? { baseName: base, cwd, schedule, loops: [] };
    existing.loops.push(loop);
    groups.set(key, existing);
  }
  const duplicateGroups = [...groups.entries()]
    .filter(([, group]) => group.loops.length > 1)
    .map(([key, group]) => ({
      key,
      baseName: group.baseName,
      cwd: group.cwd,
      schedule: group.schedule,
      loops: group.loops.map((loop) => ({
        id: loop.id,
        name: loop.name,
        status: loop.status,
        nextRunAt: loop.nextRunAt,
      })),
    }));
  return {
    ok: duplicateGroups.length === 0,
    generatedAt: new Date().toISOString(),
    checked: loops.length,
    groups: duplicateGroups,
  };
}

function commandText(loop: Loop): string {
  if (loop.target.type !== "command") return "";
  return [loop.target.command, ...(loop.target.args ?? [])].join(" ");
}

function scriptNeedles(scriptsDir: string): string[] {
  const home = userHome();
  const normalized = scriptsDir.replace(/\/+$/g, "");
  const values = [
    normalized,
    `${normalized}/`,
    "~/.hasna/loops/scripts",
    "~/.hasna/loops/scripts/",
    "$HOME/.hasna/loops/scripts",
    "$HOME/.hasna/loops/scripts/",
    "${HOME}/.hasna/loops/scripts",
    "${HOME}/.hasna/loops/scripts/",
    `${home}/.hasna/loops/scripts`,
    `${home}/.hasna/loops/scripts/`,
    "/.hasna/loops/scripts/",
  ];
  return [...new Set(values)];
}

export function buildScriptInventoryReport(
  store: Store,
  opts: { scriptsDir?: string; includeInactive?: boolean; limit?: number } = {},
): ScriptInventoryReport {
  const scriptsDir = opts.scriptsDir ?? `${userHome()}/.hasna/loops/scripts`;
  const needles = scriptNeedles(scriptsDir);
  const loops = managedLoops(store, { includeInactive: opts.includeInactive, includeStopped: true, limit: opts.limit });
  const scriptBacked = loops
    .map((loop): ScriptBackedLoop | undefined => {
      const text = commandText(loop);
      if (!text) return undefined;
      const matches = needles.filter((needle) => text.includes(needle));
      if (!matches.length) return undefined;
      return {
        id: loop.id,
        name: loop.name,
        status: loop.status,
        cwd: targetCwd(loop) || undefined,
        command: text.length > 500 ? `${text.slice(0, 500)}...` : text,
        scriptMatches: [...new Set(matches)],
      };
    })
    .filter((value): value is ScriptBackedLoop => Boolean(value));
  return {
    ok: scriptBacked.length === 0,
    generatedAt: new Date().toISOString(),
    checked: loops.length,
    scriptBacked: scriptBacked.length,
    loops: scriptBacked,
  };
}
