// Runtime placement resolution for Personal Notes clients (CLI / MCP / SDK).
//
// Mirrors the canonical loops pattern (open-loops/src/lib/mode.ts): the deployment
// mode is one of local | self_hosted | cloud, resolved from HASNA_NOTES_* env with an
// explicit precedence. Clients (CLI/MCP/SDK) NEVER hold a database DSN — when a server
// is configured they flip to HTTP via HASNA_NOTES_API_URL (+ HASNA_NOTES_API_KEY).
//
// Precedence (highest first):
//   1. HASNA_NOTES_STORAGE_MODE — explicit override (local | self_hosted | cloud)
//   2. HASNA_NOTES_API_URL      — a configured server => self_hosted (or cloud, see below)
//   3. default                  — local (SQLite/markdown on this machine)

export const DEPLOYMENT_MODES = ['local', 'self_hosted', 'cloud'];

const ENV_PREFIX = 'HASNA_NOTES_';

function env(name, source = process.env) {
  const value = source[ENV_PREFIX + name];
  return value == null ? '' : String(value).trim();
}

/**
 * Resolve the client configuration from the environment.
 * @returns {{mode:'local'|'self_hosted'|'cloud', apiUrl:string, apiKey:string}}
 */
export function resolveMode(source = process.env) {
  const explicit = env('STORAGE_MODE', source).toLowerCase();
  const apiUrl = env('API_URL', source);
  const apiKey = env('API_KEY', source);

  if (explicit) {
    if (!DEPLOYMENT_MODES.includes(explicit)) {
      throw new Error(
        `HASNA_NOTES_STORAGE_MODE must be one of ${DEPLOYMENT_MODES.join(', ')} (got "${explicit}")`,
      );
    }
    return { mode: explicit, apiUrl, apiKey };
  }

  if (apiUrl) {
    // A configured API endpoint means a server deployment someone operates.
    // "cloud" is only ever selected explicitly (the Hasna-operated SaaS control plane).
    return { mode: 'self_hosted', apiUrl, apiKey };
  }

  return { mode: 'local', apiUrl, apiKey };
}

/** True when clients should route over HTTP rather than touch local files. */
export function isRemoteMode(source = process.env) {
  const { mode, apiUrl } = resolveMode(source);
  return mode !== 'local' && !!apiUrl;
}

export default resolveMode;
