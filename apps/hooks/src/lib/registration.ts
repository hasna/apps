/**
 * Settings registration checks shared by the CLI doctor and the MCP
 * hooks_doctor.
 *
 * Event and matcher are separate settings fields — settings.hooks[event] is
 * an array of { matcher?, hooks: [...] } entries — so a composite event such
 * as 'PreToolUse:Bash' must be split before lookup, never used as a key.
 */

import { resolveHook } from "./resolve.js";

/**
 * The command forms the installer writes — `hooks run <name>` and
 * `hooks run <name> --profile <id>` — plus the legacy bare `hook-<name>` form
 * it still reads. A command outside these forms (a direct-path wire the
 * installer never wrote) is not a hook registration.
 */
const REGISTRATION_COMMAND_RE = /^(?:hooks run ([\w-]+)(?:\s+--profile\s+[\w-]+)?|hook-([\w-]+))$/;

function registrationName(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined;
  const match = command.trim().match(REGISTRATION_COMMAND_RE);
  return match ? (match[1] ?? match[2]) : undefined;
}

/** A settings registration whose hook name cannot resolve. */
export interface StaleRegistration {
  /** Settings file the registration lives in. */
  file: string;
  /** Settings event key holding the entry (PreToolUse, …). */
  event: string;
  /** The registered hook name that does not resolve. */
  hook: string;
  /** The raw command string from the settings entry. */
  command: string;
}

/**
 * Find settings registrations whose hook does not resolve.
 *
 * A registration is a `hooks run <name>` (or legacy `hook-<name>`) command;
 * it is stale when `resolveHook(name)` finds no bundled, custom or stored
 * hook — exactly the lookup `hooks run` performs, so a stale registration
 * fails on every tool call it is wired to. Direct-path wiring outside the
 * installer's own command forms is reported by `countSettingsWiring`, never
 * treated as a hook registration.
 */
export function findStaleRegistrations(
  settings: Record<string, unknown>,
  file: string,
  resolves: (name: string) => boolean = (name) => resolveHook(name) !== undefined,
): StaleRegistration[] {
  const hooks = (settings as any).hooks;
  if (!hooks || typeof hooks !== "object") return [];

  const stale: StaleRegistration[] = [];
  for (const eventKey of Object.keys(hooks)) {
    const entries = hooks[eventKey];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry?.hooks)) continue;
      for (const hook of entry.hooks) {
        const name = registrationName(hook?.command);
        if (name === undefined || resolves(name)) continue;
        stale.push({ file, event: eventKey, hook: name, command: hook.command });
      }
    }
  }
  return stale;
}

/**
 * Whether two tool matchers can select the same tool call. Deliberately loose
 * (identical, or one a substring of the other) — a false positive costs one
 * advisory warning, a false negative costs a silently disarmed guard.
 */
export function matchersOverlap(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a);
}

/** The metadata slice `findRewriteOverlaps` needs from a hook. */
export interface RewriteHookInfo {
  matcher?: string;
  event?: string;
  events?: string[];
  rewritesInput?: boolean;
}

/** Two installed hooks that both rewrite the tool input on the same tool. */
export interface RewriteOverlap {
  hooks: [string, string];
  event: string;
  matchers: [string, string];
}

function hookEventsOf(info: RewriteHookInfo): string[] {
  return info.events?.length ? info.events : info.event ? [info.event] : [];
}

/**
 * Installed hooks that both rewrite the tool input
 * (`hookSpecificOutput.updatedInput`) on an overlapping PreToolUse matcher.
 *
 * This is a real defect, not a style nit: the harness applies ONE rewrite per
 * tool call, so one of the two guards is silently disarmed. The installer
 * refuses the pairing up front; doctor reports it for settings files it did
 * not write (hand-edited, or written before the rule existed).
 */
export function findRewriteOverlaps(
  names: string[],
  lookup: (name: string) => RewriteHookInfo | undefined,
): RewriteOverlap[] {
  const rewriting = names
    .map((name) => ({ name, info: lookup(name) }))
    .filter((row): row is { name: string; info: RewriteHookInfo } => Boolean(row.info?.rewritesInput && row.info.matcher));

  const overlaps: RewriteOverlap[] = [];
  for (let i = 0; i < rewriting.length; i++) {
    for (let j = i + 1; j < rewriting.length; j++) {
      const a = rewriting[i];
      const b = rewriting[j];
      const aEvents = hookEventsOf(a.info);
      const bEvents = hookEventsOf(b.info);
      const event = aEvents.find((name) => name === "PreToolUse" && bEvents.includes(name));
      if (!event) continue;
      const aMatcher = a.info.matcher as string;
      const bMatcher = b.info.matcher as string;
      if (!matchersOverlap(aMatcher.toLowerCase(), bMatcher.toLowerCase())) continue;
      overlaps.push({ hooks: [a.name, b.name], event, matchers: [aMatcher, bMatcher] });
    }
  }
  return overlaps;
}

function safeMatcherTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

/**
 * Whether a hook is registered in a settings file.
 *
 * An entry matches when it carries a `hooks run <name>` command and, when the
 * hook declares a matcher, the entry's matcher is absent (fires on all tools)
 * or consistent with the hook's matcher (equal, or one regex matches the
 * other).
 */
/**
 * Count every raw hook entry wired in a settings file — including
 * direct-path entries that never went through the CLI (`command` values that
 * are not `hooks run <name>`). Doctor reports this count alongside the
 * registered count so its "healthy" verdict names its bounds (P2-16b).
 */
export function countSettingsWiring(settings: Record<string, unknown>): number {
  const hooks = (settings as any).hooks;
  if (!hooks || typeof hooks !== "object") return 0;
  let count = 0;
  for (const eventKey of Object.keys(hooks)) {
    const entries = hooks[eventKey];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (Array.isArray(entry?.hooks)) count += entry.hooks.length;
    }
  }
  return count;
}

export function hookRegisteredInSettings(
  settings: Record<string, unknown>,
  name: string,
  eventSpec: string,
  hookMatcher: string,
): boolean {
  const separator = eventSpec.indexOf(":");
  const eventName = separator === -1 ? eventSpec : eventSpec.slice(0, separator);
  const specMatcher = separator === -1 ? "" : eventSpec.slice(separator + 1);
  const matcher = specMatcher || hookMatcher || "";
  const hooks = (settings as any).hooks?.[eventName];
  if (!Array.isArray(hooks)) return false;
  return hooks.some((entry: any) =>
    entry?.hooks?.some((h: any) => {
      const match = h?.command?.match(/^hooks run ([\w-]+)/);
      if (!match || match[1] !== name) return false;
      if (!matcher) return true;
      const entryMatcher = typeof entry.matcher === "string" ? entry.matcher : "";
      if (!entryMatcher) return true;
      return entryMatcher === matcher || safeMatcherTest(entryMatcher, matcher) || safeMatcherTest(matcher, entryMatcher);
    }),
  );
}
