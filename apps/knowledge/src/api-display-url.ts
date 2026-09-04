/**
 * Display-URL normalization for the Hasna API gateway (issue #1588).
 *
 * The station wrappers and Keychain configure the gateway form
 * `https://api.hasna.com/<app>` (no `/v1`); requests go to
 * `https://api.hasna.com/<app>/v1/...`. Status and whoami surfaces must
 * therefore print the RESOLVED `/v1` root — never a bare base URL and never
 * the origin alone (which no longer even identifies the app behind the shared
 * gateway).
 *
 * Normalization is intentionally limited to the gateway form. Legacy per-app
 * origins (allowed for todos until hasna/apps#1512 ships) and
 * self-hosted/custom endpoints keep the caller's existing display behavior:
 * this helper returns `null` for anything that is not
 * `https://api.hasna.com/<app>` or the already-resolved
 * `https://api.hasna.com/<app>/v1`.
 */
export function gatewayApiV1Root(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.hasna.com") return null;
  // Username, password, query and fragment are never part of the resolved
  // authority: refuse rather than echo operator-supplied credential material.
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 1 && segments[0] !== "v1") {
    // Bare gateway form: `https://api.hasna.com/<app>` → resolved `/v1` root.
    return `https://api.hasna.com/${segments[0]}/v1`;
  }
  if (segments.length === 2 && segments[1] === "v1") {
    // Already the canonical form: report it unchanged.
    return `https://api.hasna.com/${segments[0]}/v1`;
  }
  return null;
}