/**
 * Hook installer - registers hooks in AI coding agent settings
 *
 * Supports:
 * - Claude Code: ~/.claude/settings.json (PreToolUse, PostToolUse, Stop, Notification, SessionStart, SessionEnd)
 * - Gemini CLI: ~/.gemini/settings.json (BeforeTool, AfterTool, AfterAgent, Notification — no session events)
 * - Codewith: emits TOML fragments by default; direct writes require explicit opt-in
 *
 * Hooks run directly from the globally installed @hasna/hooks package.
 * No files are copied. The settings entry points to `hooks run <name>`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { getHook, getHookEvents, type HookEvent } from "./registry.js";
import { resolveHookDir, resolveHookMeta } from "./resolve.js";
import { readCustomManifest, customHookDir } from "./manifest.js";
import { removeHookFromStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = existsSync(join(__dirname, "..", "..", "hooks", "hook-gitguard"))
  ? join(__dirname, "..", "..", "hooks")
  : join(__dirname, "..", "hooks");

export type Scope = "global" | "project";
export type Target = "claude" | "gemini" | "codewith" | "all";
type WritableJsonTarget = "claude" | "gemini";
type SingleTarget = Exclude<Target, "all">;
export type ConcreteTarget = SingleTarget;
export type CodewithInstallMode = "fragment" | "write";

function normalizeHookName(name: string): string {
  return name.startsWith("hook-") ? name : `hook-${name}`;
}

function shortHookName(name: string): string {
  return name.startsWith("hook-") ? name.slice("hook-".length) : name;
}

function removeHookEntriesByName(entries: any[], hookName: string): any[] {
  return entries.filter(
    (entry: any) => !entry.hooks?.some((h: any) => {
      // [\w-]+ — hook names may contain hyphens (announce-start, fleet-catchup, …)
      const match = h.command?.match(/^hooks run ([\w-]+)/);
      return match && match[1] === hookName;
    })
  );
}

/**
 * Map our internal event names to each target's event names.
 * `null` means the target has no equivalent surface for that event —
 * installs for that target fail with a clear error instead of writing
 * an event key the runtime would silently ignore.
 */
const EVENT_MAP: Record<SingleTarget, Record<HookEvent, string | null>> = {
  claude: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    Stop: "Stop",
    Notification: "Notification",
    SessionStart: "SessionStart",
    SessionEnd: "SessionEnd",
    UserPromptSubmit: null,
    SubagentStart: null,
  },
  gemini: {
    PreToolUse: "BeforeTool",
    PostToolUse: "AfterTool",
    Stop: "AfterAgent",
    Notification: "Notification",
    SessionStart: null,
    SessionEnd: null,
    UserPromptSubmit: null,
    SubagentStart: null,
  },
  codewith: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    Stop: "Stop",
    Notification: null,
    SessionStart: "SessionStart",
    SessionEnd: null,
    UserPromptSubmit: "UserPromptSubmit",
    SubagentStart: "SubagentStart",
  },
};

/** Settings file paths per target */
function getTargetSettingsDir(target: SingleTarget): string {
  if (target === "codewith") return ".codewith";
  if (target === "gemini") return ".gemini";
  return ".claude";
}

function getGlobalSettingsPathOverride(target: SingleTarget): string | undefined {
  if (target === "claude") return process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH;
  if (target === "gemini") return process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH;
  return undefined;
}

export interface InstallResult {
  hook: string;
  success: boolean;
  error?: string;
  scope?: Scope;
  target?: Target;
  conflict?: string;
  fragment?: string;
  applied?: boolean;
  note?: string;
  configPath?: string;
}

export interface InstallOptions {
  scope?: Scope;
  overwrite?: boolean;
  target?: Target;
  profile?: string;
  /**
   * Codewith installs default to "fragment" so @hasna/hooks does not blindly
   * mutate managed ~/.codewith/config.toml. Use "write" only with an explicit
   * config path or in tests/local experiments.
   */
  codewithMode?: CodewithInstallMode;
  /** Explicit Codewith config path for the direct-write mode and tests. */
  codewithConfigPath?: string;
}

export function getSettingsPath(scope: Scope = "global", target: SingleTarget = "claude", codewithConfigPath?: string): string {
  if (target === "codewith" && codewithConfigPath) return codewithConfigPath;
  // P2-15: the env override names the GLOBAL codewith config only; a
  // project-scoped codewith config is always the cwd-relative one, or the
  // two scopes would silently edit the same file.
  if (target === "codewith" && scope === "global" && process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH) {
    return process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH;
  }
  const globalOverride = scope === "global" ? getGlobalSettingsPathOverride(target) : undefined;
  if (globalOverride) return globalOverride;
  const dir = getTargetSettingsDir(target);
  if (scope === "project") {
    return target === "codewith" ? join(process.cwd(), dir, "config.toml") : join(process.cwd(), dir, "settings.json");
  }
  return target === "codewith" ? join(homedir(), dir, "config.toml") : join(homedir(), dir, "settings.json");
}

export function getHookPath(name: string): string {
  const shortName = shortHookName(name);
  const resolved = resolveHookDir(shortName);
  if (resolved) return resolved;
  return join(HOOKS_DIR, normalizeHookName(shortName));
}

export function hookExists(name: string): boolean {
  return existsSync(getHookPath(name));
}

function readSettings(scope: Scope = "global", target: WritableJsonTarget = "claude"): Record<string, any> {
  const path = getSettingsPath(scope, target);
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch (error) {
    console.warn(`[hooks] Failed to read settings at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {};
}

function writeSettings(settings: Record<string, any>, scope: Scope = "global", target: WritableJsonTarget = "claude"): void {
  const path = getSettingsPath(scope, target);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

function getTargetEventName(internalEvent: HookEvent, target: SingleTarget): string | null {
  return EVENT_MAP[target]?.[internalEvent] ?? null;
}

/** Whether a hook's event can be registered for the given target */
export function isEventSupported(internalEvent: HookEvent, target: SingleTarget): boolean {
  return getTargetEventName(internalEvent, target) !== null;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function codewithMatcher(matcher: string): string | undefined {
  if (!matcher) return undefined;
  if (matcher.startsWith("^")) return matcher;
  if (matcher.includes("|")) return `^(${matcher})$`;
  return `^${matcher}$`;
}

function codewithTimeout(name: string): number {
  switch (name) {
    case "knowledge-context":
      return 6;
    case "session-start":
      return 8;
    case "pre-bash":
      return 20;
    case "prompt-guard":
      return 3;
    case "worktree-guard":
    case "stop-sync":
      return 5;
    default:
      return 10;
  }
}

function codewithStatusMessage(name: string): string {
  switch (name) {
    case "knowledge-context":
      return "Loading Knowledge context";
    case "session-start":
      return "Checking Hasna session context";
    case "pre-bash":
      return "Checking Bash safety";
    case "prompt-guard":
      return "Checking prompt safety";
    case "worktree-guard":
      return "Checking worktree safety";
    case "stop-sync":
      return "Syncing turn-end heartbeat";
    default:
      return `Running ${name}`;
  }
}

export function buildCodewithTomlFragment(name: string, profile?: string): string {
  const shortName = shortHookName(name);
  const meta = resolveHookMeta(shortName);
  if (!meta) throw new Error(`Hook '${shortName}' not found`);

  const command = profile ? `hooks run ${shortName} --profile ${profile}` : `hooks run ${shortName}`;
  const matcher = codewithMatcher(meta.matcher);
  const fragments: string[] = [];

  for (const event of getHookEvents(meta)) {
    const eventKey = getTargetEventName(event, "codewith");
    if (!eventKey) {
      throw new Error(`Hook '${shortName}' uses event '${event}', which is not supported by the Codewith target`);
    }

    const lines: string[] = [
      `[[hooks.${eventKey}]]`,
    ];
    if (matcher) lines.push(`matcher = ${tomlString(matcher)}`);
    lines.push(
      "",
      `[[hooks.${eventKey}.hooks]]`,
      `type = "command"`,
      `command = ${tomlString(command)}`,
      `timeout = ${codewithTimeout(shortName)}`,
      `statusMessage = ${tomlString(codewithStatusMessage(shortName))}`,
    );
    fragments.push(lines.join("\n"));
  }

  return `${fragments.join("\n\n")}\n`;
}

function readCodewithConfig(scope: Scope, configPath?: string): string {
  const path = getSettingsPath(scope, "codewith", configPath);
  try {
    return existsSync(path) ? readFileSync(path, "utf-8") : "";
  } catch {
    return "";
  }
}

function appendCodewithFragment(fragment: string, scope: Scope, configPath?: string): string {
  const path = getSettingsPath(scope, "codewith", configPath);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const sep = existing.trim() ? "\n\n" : "";
  writeFileSync(path, `${existing.replace(/\s*$/, "")}${sep}${fragment}`);
  return path;
}

/** Check if a hook conflicts with any already-installed hook (same event + overlapping matcher) */
function detectConflict(name: string, scope: Scope, target: SingleTarget): string | undefined {
  const meta = resolveHookMeta(name);
  if (!meta || !meta.matcher) return undefined; // hooks with no matcher can't conflict
  const events = new Set(getHookEvents(meta));

  const registered = getRegisteredHooksForTarget(scope, target);
  for (const existingName of registered) {
    if (existingName === name) continue;
    const existing = getHook(existingName);
    if (!existing || !existing.matcher) continue;
    if (!getHookEvents(existing).some((event) => events.has(event))) continue;
    // Check if matchers overlap (either is a substring/prefix of the other, or identical)
    const a = meta.matcher.toLowerCase();
    const b = existing.matcher.toLowerCase();
    if (a === b || a.includes(b) || b.includes(a)) {
      return `conflicts with '${existingName}' (same event ${meta.event}, overlapping matcher '${existing.matcher}')`;
    }
  }
  return undefined;
}

function installForTarget(
  name: string,
  scope: Scope,
  overwrite: boolean,
  target: SingleTarget,
  profile?: string,
  codewithMode: CodewithInstallMode = "fragment",
  codewithConfigPath?: string,
): InstallResult {
  const shortName = shortHookName(name);

  if (!hookExists(shortName)) {
    return { hook: shortName, success: false, error: `Hook '${shortName}' not found`, target };
  }

  if (target === "codewith") {
    try {
      const fragment = buildCodewithTomlFragment(shortName, profile);
      if (codewithMode !== "write") {
        return {
          hook: shortName,
          success: true,
          scope,
          target,
          fragment,
          applied: false,
          note: "Codewith install is fragment-only by default; configs should own applying this TOML.",
        };
      }

      if (!codewithConfigPath) {
        return {
          hook: shortName,
          success: false,
          error: "Direct Codewith writes require an explicit --codewith-config path; refusing to write default ~/.codewith/config.toml.",
          scope,
          target,
          fragment,
          applied: false,
        };
      }

      const existing = readCodewithConfig(scope, codewithConfigPath);
      if (!overwrite && new RegExp(`command\\s*=\\s*["']hooks run ${shortName}(?:\\s|["'])`).test(existing)) {
        return { hook: shortName, success: false, error: "Already installed. Use --overwrite to append another fragment.", scope, target };
      }
      const path = appendCodewithFragment(fragment, scope, codewithConfigPath);
      return {
        hook: shortName,
        success: true,
        scope,
        target,
        fragment,
        applied: true,
        configPath: path,
        note: "Direct Codewith config write was explicitly requested; prefer configs for managed machines.",
      };
    } catch (error) {
      return {
        hook: shortName,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        target,
      };
    }
  }

  const registered = getRegisteredHooksForTarget(scope, target);
  if (registered.includes(shortName) && !overwrite) {
    return { hook: shortName, success: false, error: "Already installed. Use --overwrite to replace.", scope, target };
  }

  // Warn on conflicts (non-blocking — still installs)
  const conflict = detectConflict(shortName, scope, target);

  try {
    registerHook(shortName, scope, target, profile);
    return { hook: shortName, success: true, scope, target, ...(conflict ? { conflict } : {}) };
  } catch (error) {
    return {
      hook: shortName,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      target,
    };
  }
}

export function installHook(name: string, options: InstallOptions = {}): InstallResult {
  const { scope = "global", overwrite = false, target = "claude", profile, codewithMode = "fragment", codewithConfigPath } = options;

  if (target === "all") {
    const shortName = shortHookName(name);
    const meta = resolveHookMeta(shortName);
    if (meta) {
      const unsupportedTargets = (["claude", "codewith"] as const).filter(
        (agentTarget) => getHookEvents(meta).some((event) => !isEventSupported(event, agentTarget))
      );
      if (unsupportedTargets.length > 0) {
        return {
          hook: shortName,
          success: false,
          error: `Event(s) '${getHookEvents(meta).join(", ")}' are not supported by target(s): ${unsupportedTargets.join(", ")}`,
          target: "all",
        };
      }
    }

    const claudeResult = installForTarget(name, scope, overwrite, "claude", profile);
    if (!claudeResult.success) {
      return {
        ...claudeResult,
        error: `Failed for target 'claude': ${claudeResult.error}`,
        target: "all",
      };
    }
    const codewithResult = installForTarget(name, scope, overwrite, "codewith", profile, codewithMode, codewithConfigPath);
    if (!codewithResult.success) {
      return {
        ...codewithResult,
        error: `Failed for target 'codewith': ${codewithResult.error}`,
        target: "all",
      };
    }
    return { ...claudeResult, target: "all" };
  }

  return installForTarget(name, scope, overwrite, target as SingleTarget, profile, codewithMode, codewithConfigPath);
}

function registerHook(name: string, scope: Scope = "global", target: WritableJsonTarget = "claude", profile?: string): void {
  const meta = resolveHookMeta(name);
  if (!meta) return;

  const eventKeys = getHookEvents(meta).map((event) => {
    const eventKey = getTargetEventName(event, target);
    if (eventKey === null) {
      throw new Error(`Event '${event}' is not supported by target '${target}'`);
    }
    return eventKey;
  });
  const uniqueEventKeys = [...new Set(eventKeys)];
  if (uniqueEventKeys.length === 0) {
    throw new Error(`Hook '${name}' has no installable events for target '${target}'`);
  }

  const settings = readSettings(scope, target);
  if (!settings.hooks) settings.hooks = {};

  // Remove any existing entries for this hook from ALL event keys —
  // a hook may have been rebound to a different event since it was installed
  // (e.g. announce-start moved from Notification to SessionStart).
  removeHookFromAllEvents(settings, name);

  const hookCommand = profile
    ? `hooks run ${name} --profile ${profile}`
    : `hooks run ${name}`;

  for (const eventKey of uniqueEventKeys) {
    if (!settings.hooks[eventKey]) settings.hooks[eventKey] = [];

    const entry: Record<string, any> = {
      hooks: [{ type: "command", command: hookCommand }],
    };
    if (meta.matcher) {
      entry.matcher = meta.matcher;
    }
    settings.hooks[eventKey].push(entry);
  }
  writeSettings(settings, scope, target);
}

/** Strip a hook's entries from every event key, deleting keys that become empty */
function removeHookFromAllEvents(settings: Record<string, any>, name: string): void {
  if (!settings.hooks) return;
  for (const key of Object.keys(settings.hooks)) {
    settings.hooks[key] = removeHookEntriesByName(settings.hooks[key], name);
    if (settings.hooks[key].length === 0) {
      delete settings.hooks[key];
    }
  }
}

function unregisterHook(name: string, scope: Scope = "global", target: WritableJsonTarget = "claude"): void {
  const settings = readSettings(scope, target);
  if (!settings.hooks) return;

  // Remove by hook name across all event keys — works regardless of profile,
  // regardless of which event the hook was bound to when installed, and
  // regardless of whether the hook still has any resolvable meta (a stale
  // registration must be removable; QA-1 BUG-A).
  removeHookFromAllEvents(settings, name);

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settings, scope, target);
}

export function installHooks(names: string[], options: InstallOptions = {}): InstallResult[] {
  return names.map((name) => installHook(name, options));
}

export function getRegisteredHooksForTarget(scope: Scope = "global", target: SingleTarget = "claude"): string[] {
  if (target === "codewith") {
    const config = readCodewithConfig(scope);
    const registered: string[] = [];
    const re = /command\s*=\s*["']hooks run ([\w-]+)(?:\s+--profile\s+[\w-]+)?["']/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(config))) {
      registered.push(match[1]);
    }
    return [...new Set(registered)];
  }

  const settings = readSettings(scope, target);
  if (!settings.hooks) return [];

  const registered: string[] = [];
  for (const eventKey of Object.keys(settings.hooks)) {
    for (const entry of settings.hooks[eventKey]) {
      for (const hook of entry.hooks || []) {
        const newMatch = hook.command?.match(/^hooks run ([\w-]+)(?:\s+--profile\s+[\w-]+)?$/);
        const oldMatch = hook.command?.match(/^hook-([\w-]+)$/);
        const match = newMatch || oldMatch;
        if (match) {
          registered.push(match[1]);
        }
      }
    }
  }
  return [...new Set(registered)];
}

export function getRegisteredHooks(scope: Scope = "global"): string[] {
  return getRegisteredHooksForTarget(scope, "claude");
}

/** @deprecated Use getRegisteredHooks instead */
export const getInstalledHooks = getRegisteredHooks;

export function removeHook(name: string, scope: Scope = "global", target: Target = "claude"): boolean {
  const shortName = shortHookName(name);

  if (target === "all") {
    const claudeRemoved = removeHookForTarget(shortName, scope, "claude");
    const geminiRemoved = removeHookForTarget(shortName, scope, "gemini");
    return claudeRemoved || geminiRemoved;
  }

  if (target === "codewith") {
    // Codewith config is TOML and usually managed by configs. Avoid
    // attempting lossy TOML edits here; emit fragments for install instead.
    return false;
  }

  return removeHookForTarget(shortName, scope, target as WritableJsonTarget);
}

function removeHookForTarget(name: string, scope: Scope, target: WritableJsonTarget): boolean {
  const registered = getRegisteredHooksForTarget(scope, target);
  if (!registered.includes(name)) {
    return false;
  }
  unregisterHook(name, scope, target);
  return true;
}

export interface UninstallResult {
  name: string;
  removed: boolean;
  source: "custom" | "bundled" | "registered-only" | null;
  settingsScopes: Scope[];
  storeDirRemoved: boolean;
  pinRemoved: boolean;
  dbRecordRemoved: boolean;
  /** Targets whose config still registers the hook after removal (e.g. codewith TOML the caller must edit itself). */
  registrationsRemaining: string[];
  error?: string;
}

/**
 * Lossless removal of a `hooks run <name>` entry from a Codewith config.toml.
 *
 * Works on sections split by blank lines — the shape buildCodewithTomlFragment
 * writes: a `[[hooks.EVENT]]` header section (with optional matcher), then one
 * `[[hooks.EVENT.hooks]]` entry section per hook containing
 * `command = "hooks run <name>"`. Only sections positively identified as this
 * hook's entries are removed; the enclosing EVENT header is dropped only when
 * every one of its entries belonged to this hook. Anything ambiguous is
 * preserved verbatim.
 */
export function removeCodewithHookEntry(configText: string, name: string): { text: string; removed: boolean } {
  const sections = configText.split(/\n\s*\n/);
  const nameRe = new RegExp(`^command\\s*=\\s*"hooks run ${escapeRegExp(name)}(?:\\s+--profile\\s+[\\w-]+)?"$`);
  const entryHeaderRe = /^\[\[hooks\.([\w]+)\.hooks\]\]$/;
  const eventHeaderRe = /^\[\[hooks\.([\w]+)\]\]$/;

  // First pass: classify sections and drop this hook's entry sections.
  const eventsWithEntries = new Set<string>();
  const kept: Array<{ text: string; eventHeaderFor?: string }> = [];
  let removed = false;
  for (const section of sections) {
    const lines = section.split("\n");
    const entryMatch = entryHeaderRe.exec(lines[0] ?? "");
    if (entryMatch) {
      const event = entryMatch[1];
      eventsWithEntries.add(event);
      if (lines.some((line) => nameRe.test(line.trim()))) {
        removed = true;
        continue; // drop this entry section
      }
      kept.push({ text: section });
      continue;
    }
    const eventMatch = eventHeaderRe.exec(lines[0] ?? "");
    kept.push({ text: section, eventHeaderFor: eventMatch ? eventMatch[1] : undefined });
  }

  // Second pass: drop an EVENT header section only when every one of its
  // entry sections was consumed (no kept entry section for that event).
  const keptEntriesByEvent = new Set<string>();
  for (const item of kept) {
    const m = entryHeaderRe.exec(item.text.split("\n")[0] ?? "");
    if (m) keptEntriesByEvent.add(m[1]);
  }
  const finalSections = kept
    .filter((item) => {
      if (item.eventHeaderFor === undefined) return true;
      if (!eventsWithEntries.has(item.eventHeaderFor)) return true; // header with no entries — not ours
      return keptEntriesByEvent.has(item.eventHeaderFor);
    })
    .map((item) => item.text);

  return {
    text: finalSections.join("\n\n") + (configText.endsWith("\n") ? "\n" : ""),
    removed,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codewithHasHookEntryInText(configText: string, name: string): boolean {
  return new RegExp(`hooks run ${escapeRegExp(name)}(?:\\s+--profile\\s+[\\w-]+)?(?:$|\\s|")`).test(configText);
}

function codewithHasHookEntry(name: string, scope: Scope = "global"): boolean {
  // P2-15: the codewith config is resolved for the SAME scope the operation
  // runs in — a project-scoped uninstall must not edit the global TOML.
  const path = getSettingsPath(scope, "codewith");
  if (!existsSync(path)) return false;
  try {
    return codewithHasHookEntryInText(readFileSync(path, "utf-8"), name);
  } catch {
    return false;
  }
}

/**
 * Full uninstall — the settings registration, the store directory (custom
 * hooks), the lock pin and the DB record are all removed. Bundled hooks keep
 * their package files (they belong to the package, not the store).
 *
 * Resolves custom and registry-synced hooks, which live in the custom store
 * dir, as well as bundled ones (QA-1 BUG-A / QA-4: remove was bundled-only
 * and never cleaned the store/lock/DB).
 */

// Fail-closed recursive store removal. `rmSync(dir, { recursive: true })`
// deletes entries in filesystem listing order, so a frozen SUBDIRECTORY can
// leave sibling files (e.g. script.sh) already unlinked when the removal
// throws — a partially-deleted store that still keeps its trust records.
// Process directory subtrees first: a frozen subdirectory aborts the removal
// BEFORE any sibling file is touched, preserving the fail-closed invariant
// (O15 regression: uninstallHook store-freeze test on ext4-order runners).
// rmdirSync doubles as the failure probe: a subtree that failed to empty
// itself makes the parent removal throw, and nothing is reported removed.
function removeStoreDirFailClosed(dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      removeStoreDirFailClosed(join(dir, entry.name));
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      unlinkSync(join(dir, entry.name));
    }
  }
  rmdirSync(dir);
}

export function uninstallHook(
  name: string,
  scope: Scope = "global",
  target: Target = "claude",
): UninstallResult {
  const shortName = shortHookName(name);

  const custom = readCustomManifest(shortName);
  const bundledMeta = custom ? undefined : getHook(shortName);
  const existsInTarget = (t: WritableJsonTarget) =>
    getRegisteredHooksForTarget("global", t).includes(shortName) ||
    getRegisteredHooksForTarget("project", t).includes(shortName);
  const registeredClaudeOrGemini = target === "all" ? existsInTarget("claude") || existsInTarget("gemini") : false;
  const registeredGlobal = registeredClaudeOrGemini || getRegisteredHooksForTarget("global", target === "all" ? "claude" : (target as WritableJsonTarget)).includes(shortName);
  const registeredProject = registeredClaudeOrGemini || getRegisteredHooksForTarget("project", target === "all" ? "claude" : (target as WritableJsonTarget)).includes(shortName);

  // A hook registered only in the Codewith TOML must still resolve for
  // --target codewith / --target all (recheck P1: codewith-only hooks were
  // reported "not found").
  const codewithOnly = (target === "codewith" || target === "all") && codewithHasHookEntry(shortName, scope);

  if (!custom && !bundledMeta && !registeredGlobal && !registeredProject && !codewithOnly) {
    return { name: shortName, removed: false, source: null, settingsScopes: [], storeDirRemoved: false, pinRemoved: false, dbRecordRemoved: false, registrationsRemaining: [], error: `Hook '${shortName}' not found` };
  }

  const writableTargets = target === "all" ? (["claude", "gemini"] as const) : target === "codewith" ? [] : [target as WritableJsonTarget];
  const scopes: Scope[] = [];
  for (const s of (["global", "project"] as Scope[])) {
    for (const t of writableTargets) {
      if (getRegisteredHooksForTarget(s, t).includes(shortName)) {
        unregisterHook(shortName, s, t);
        if (!scopes.includes(s)) scopes.push(s);
      }
    }
  }

  // Codewith registrations live in TOML; remove them losslessly when the
  // target covers codewith. Any entry that remains after removal (an
  // ambiguous form we cannot positively identify) is reported, never
  // silently dropped.
  const registrationsRemaining: string[] = [];
  if (target === "codewith" || target === "all") {
    // P2-15: resolve the config for the operation's own scope — never the
    // hardcoded global path.
    const codewithPath = getSettingsPath(scope, "codewith");
    if (existsSync(codewithPath)) {
      const before = readFileSync(codewithPath, "utf-8");
      const after = removeCodewithHookEntry(before, shortName);
      if (after.removed) {
        writeFileSync(codewithPath, after.text, "utf-8");
      }
      // Re-scan the (possibly modified) text: any `hooks run <name>` that
      // survives — e.g. an inline-table entry our section remover cannot
      // positively identify — is reported as remaining (recheck P1).
      if (codewithHasHookEntryInText(after.removed ? after.text : before, shortName)) {
        registrationsRemaining.push("codewith");
      }
    }
  }

  // Fail-closed store removal: the executable bytes must be gone before the
  // trust records are erased. If the store dir cannot be removed, keep the
  // pin and DB record intact and report a hard failure — otherwise the next
  // run would self-trust the residual bytes (security reviewer P1-2).
  if (custom) {
    try {
      removeStoreDirFailClosed(customHookDir(shortName));
    } catch {
      return {
        name: shortName,
        removed: false,
        source: "custom",
        settingsScopes: scopes,
        storeDirRemoved: false,
        pinRemoved: false,
        dbRecordRemoved: false,
        registrationsRemaining,
        error: `Hook '${shortName}' store directory could not be removed; trust records preserved (no fail-open)`,
      };
    }
  }

  const { removedPin, removedRecord } = removeHookFromStore(shortName);

  return {
    name: shortName,
    removed: true,
    source: custom ? "custom" : bundledMeta ? "bundled" : "registered-only",
    settingsScopes: scopes,
    storeDirRemoved: custom ? true : false,
    pinRemoved: removedPin,
    dbRecordRemoved: removedRecord,
    registrationsRemaining,
  };
}
