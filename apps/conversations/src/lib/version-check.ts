// ── npm update check ─────────────────────────────────────────────────────────
//
// The published-version lookup for the `doctor` and `update` CLI commands. This is
// a package-registry probe, NOT conversations data — so it deliberately lives in
// its own helper instead of a raw `fetch` inside a command. Keeping it here means
// no CLI command reaches for `fetch` directly (mirroring the "route data through
// the Store, never raw fetch in a command" rule) and the two callers share one
// implementation.

import pkg from "../../package.json";

const NPM_LATEST_URL = "https://registry.npmjs.org/@hasna/conversations/latest";

export interface UpdateInfo {
  current: string;
  /** Latest published version, or `null` when the registry could not be reached. */
  latest: string | null;
  updateAvailable: boolean;
}

/**
 * Check npm for the latest published `@hasna/conversations` version. Never throws:
 * on any network/parse failure it returns `latest: null` so callers can degrade
 * gracefully (offline is not a hard error for a version check).
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = pkg.version;
  try {
    const res = await fetch(NPM_LATEST_URL);
    if (!res.ok) return { current, latest: null, updateAvailable: false };
    const data = (await res.json()) as { version?: string };
    const latest = typeof data?.version === "string" ? data.version : null;
    return { current, latest, updateAvailable: latest !== null && latest !== current };
  } catch {
    return { current, latest: null, updateAvailable: false };
  }
}
