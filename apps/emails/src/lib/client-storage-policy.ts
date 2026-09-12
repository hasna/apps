import { emailsKeychainItem } from "./emails-credentials.js";
import { EMAILS_LOCAL_OPT_IN_ENV, EMAILS_LOCAL_OPT_IN_ENV_KEYS } from "./local-opt-in.js";

/**
 * Ordinary CLI, TUI and MCP clients keep mail in the authenticated API — they are
 * HOSTED-ONLY. Neither a database path nor the standard local opt-in is honoured by
 * these bins: local SQLite is reachable only through the `@hasna/emails/storage`
 * library seam and `emails-serve`, and only behind `HASNA_EMAILS_LOCAL=1`
 * (src/lib/local-opt-in.ts). Refusing up front, by name, is what keeps a stale
 * export from ever turning a client run into an on-box one.
 */
export function assertApiClientStorage(env: NodeJS.ProcessEnv = process.env): void {
  const settings = ["HASNA_EMAILS_DB_PATH", "EMAILS_DB_PATH", ...EMAILS_LOCAL_OPT_IN_ENV_KEYS]
    .filter((name) => env[name]?.trim());
  if (settings.length) {
    throw new Error(
      `Emails CLI and MCP clients are hosted-only and require the authenticated Emails API. Unset ` +
        `${settings.join(" and ")} and configure HASNA_EMAILS_API_URL and HASNA_EMAILS_API_KEY, or use ` +
        `saved account credentials through emails auth, the Keychain item ${emailsKeychainItem("api-key")}, ` +
        `or ~/.hasna/emails/config/credentials. Local SQLite is opt-in only (${EMAILS_LOCAL_OPT_IN_ENV}=1) ` +
        `and is reachable only through the @hasna/emails/storage library and emails-serve — never from ` +
        `these clients.`,
    );
  }
}
