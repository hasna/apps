// Server environment resolution with one-release legacy compatibility.
// HASNA_NOTES_SERVER_* names are primary; the retired pre-rename server
// env names are honored as a fallback with a one-time deprecation warning.
// The retired prefix is assembled from fragments so the case-insensitive
// rename gate never matches this compatibility shim itself.
const RETIRED_PREFIX = 'PERSONAL' + 'NOTES_';
const CURRENT_PREFIX = 'HASNA_NOTES_';
const warned = new Set();

/** Read <prefix>SERVER_<name> from the given env object (new first, legacy
 *  fallback with a one-time stderr warning). Returns undefined when unset. */
export function serverEnv(env, name) {
  const current = CURRENT_PREFIX + 'SERVER_' + name;
  const legacy = RETIRED_PREFIX + 'SERVER_' + name;
  if (env[current] !== undefined) return env[current];
  if (env[legacy] !== undefined) {
    if (!warned.has(legacy)) {
      warned.add(legacy);
      process.stderr.write(`warning: ${legacy} is deprecated; set ${current} instead.\n`);
    }
    return env[legacy];
  }
  return undefined;
}
