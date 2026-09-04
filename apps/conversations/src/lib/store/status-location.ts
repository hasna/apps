import { getDbPath } from "../db.js";
import { loggableUrl } from "../loggable-url.js";
import { cloudApiUrl, isCloudStore } from "./index.js";

type Env = Record<string, string | undefined>;

/**
 * Resolve the canonical API authority to DISPLAY for a configured base URL
 * (issue #1588).
 *
 * Station wrappers configure the gateway form `https://api.hasna.com/<app>`
 * (no `/v1`); requests go to `https://api.hasna.com/<app>/v1/...`. Status and
 * whoami surfaces must therefore print the RESOLVED `/v1` root — never the
 * bare base URL and never the origin alone (which no longer even identifies
 * the app behind the shared gateway).
 *
 * Normalization is intentionally limited to the gateway form. Legacy origins
 * (`https://<app>.hasna.xyz`, allowed for todos until hasna/apps#1512 ships)
 * and self-hosted/custom endpoints keep the caller's existing display behavior
 * (`loggableUrl`, which redacts down to scheme/host/port): this returns `null`
 * for anything that is not `https://api.hasna.com/<app>` or the
 * already-resolved `https://api.hasna.com/<app>/v1`.
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

/**
 * The safest true thing that can be said about the connection that answered.
 *
 * A union rather than one type with two optional fields, so `api_url` and
 * `db_path` cannot both be present: a status payload carrying both would say
 * nothing about which connection actually served the request.
 */
export type StoreStatusLocation =
  | { api_url: string | null }
  | { db_path: string };

/**
 * The store-location fragment of every status payload.
 *
 * WHY THIS IS A SHARED FUNCTION AND NOT TWO INLINE SPREADS. It was two inline
 * spreads — identical ones, in `cli/commands/analytics.ts` and `server/serve.ts`
 * — and both leaked the raw `HASNA_CONVERSATIONS_API_URL`, userinfo and fragment
 * included, into three output surfaces: the human `conversations status`, its
 * `--json` form, and the server's unauthenticated `/api/status` body. Fixing the
 * reported call site and leaving the other is the shape that produced the defect
 * in the first place, so the fragment is produced in exactly one place and a
 * third status surface added later inherits the redaction instead of having to
 * remember it.
 *
 * The `api_url`/`db_path` split is load-bearing: it makes a status response say
 * which connection answered, so an unexpected fallback to the on-box SQLite file
 * is visible rather than having to be inferred from a channel count. Redaction
 * narrows the VALUE; it must not blur which field is present, and the union above
 * enforces that.
 */
export function storeStatusLocation(env: Env = process.env): StoreStatusLocation {
  // `env` reaches BOTH branches. It previously reached only the cloud one, while
  // `getDbPath()` read `process.env` directly — so a caller (or a test) that
  // injected a DB path got an answer the injection had not influenced.
  if (!isCloudStore(env)) return { db_path: getDbPath(env) };
  const raw = cloudApiUrl(env);
  // Gateway-form URLs are safe to show as their resolved `/v1` root. Everything
  // else goes through `loggableUrl`, whose scheme/host/port allow-list keeps the
  // redaction leak-proof (issue #1588).
  return { api_url: gatewayApiV1Root(raw) ?? loggableUrl(raw) };
}
