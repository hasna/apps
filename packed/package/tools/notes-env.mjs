// Environment resolution for the notes app. Only the current HASNA_NOTES_*
// names are read — the pre-rename PERSONALNOTES_* compatibility aliases were
// removed with the sync/cloud machinery (they were one-release bridges).
const PREFIX = 'HASNA_NOTES_';

/** Read HASNA_NOTES_<name>. Returns undefined when unset. */
export function hasnaEnv(name) {
  return process.env[PREFIX + name];
}
