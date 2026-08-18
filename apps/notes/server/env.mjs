// Server environment resolution. Only the current HASNA_NOTES_SERVER_* names
// are read — the pre-rename PERSONALNOTES_SERVER_* compatibility aliases were
// removed (they were one-release bridges for the rename).
const PREFIX = 'HASNA_NOTES_';

/** Read HASNA_NOTES_SERVER_<name> from the given env object. Returns undefined when unset. */
export function serverEnv(env, name) {
  return env[PREFIX + 'SERVER_' + name];
}
