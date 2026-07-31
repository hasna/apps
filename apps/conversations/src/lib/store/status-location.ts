import { getDbPath } from "../db.js";
import { loggableUrl } from "../loggable-url.js";
import { cloudApiUrl, isCloudStore } from "./index.js";

type Env = Record<string, string | undefined>;

/**
 * Which store answered, and the safest true thing that can be said about where
 * it is.
 *
 * A union rather than one type with two optional fields, so `api_url` and
 * `db_path` cannot both be present: a status payload carrying both would say
 * nothing about which store actually served the request, which is the one
 * question this shape exists to answer.
 */
export type StoreStatusLocation =
  | { mode: "self_hosted"; api_url: string | null }
  | { mode: "local"; db_path: string };

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
 * The `mode` field and the `api_url`/`db_path` split are load-bearing and are
 * preserved exactly: they make a status response say which store answered, so a
 * silent downgrade to the on-box SQLite file is visible in the response rather
 * than having to be inferred from a channel count. Redaction narrows the VALUE;
 * it must not blur which field is present, and the union above enforces that.
 */
export function storeStatusLocation(env: Env = process.env): StoreStatusLocation {
  if (!isCloudStore(env)) return { mode: "local", db_path: getDbPath() };
  return { mode: "self_hosted", api_url: loggableUrl(cloudApiUrl(env)) };
}
