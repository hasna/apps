/**
 * Settings registration checks shared by the CLI doctor and the MCP
 * hooks_doctor.
 *
 * Event and matcher are separate settings fields — settings.hooks[event] is
 * an array of { matcher?, hooks: [...] } entries — so a composite event such
 * as 'PreToolUse:Bash' must be split before lookup, never used as a key.
 */

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
