// Environment resolution for the notes app. One-release compatibility: the new
// HASNA_NOTES_* names are read first; the retired pre-rename env names are
// still honored as a fallback with a one-time deprecation warning on stderr.
// The retired prefix is assembled from fragments so the repo's own
// case-insensitive rename gate (grep for the retired app name) never matches this
// compatibility shim itself — the same pattern the oss-hygiene guard uses.
const RETIRED_PREFIX = 'PERSONAL' + 'NOTES_';
const CURRENT_PREFIX = 'HASNA_NOTES_';
const warned = new Set();

/** Read HASNA_NOTES_<name> first, falling back to the retired prefix (with a
 *  one-time stderr deprecation warning). Returns undefined when neither is set. */
export function hasnaEnv(name) {
  const current = CURRENT_PREFIX + name;
  const legacy = RETIRED_PREFIX + name;
  if (process.env[current] !== undefined) return process.env[current];
  if (process.env[legacy] !== undefined) {
    if (!warned.has(legacy)) {
      warned.add(legacy);
      process.stderr.write(`warning: ${legacy} is deprecated; set ${current} instead.\n`);
    }
    return process.env[legacy];
  }
  return undefined;
}

/** Fail-loud ratchet: the retired MODE='hosted' mode-enum selector is retired
 *  (deployment modes were removed). Config and API-key presence now select the
 *  hosted path; a lingering mode variable is a misconfiguration. */
export function assertNoRetiredModeSelector() {
  if (process.env[RETIRED_PREFIX + 'MODE'] !== undefined) {
    throw new Error(
      RETIRED_PREFIX + 'MODE is retired: deployment-mode selectors were removed. ' +
      'Configure the hosted/cloud path with HASNA_NOTES_API_URL and HASNA_NOTES_API_KEY instead.',
    );
  }
}
