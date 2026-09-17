import { emailsKeychainItem } from "./emails-credentials.js";
import { EMAILS_LOCAL_OPT_IN_ENV, EMAILS_LOCAL_OPT_IN_ENV_KEYS } from "./local-opt-in.js";

/**
 * Ordinary CLI, TUI and MCP clients keep mail in the authenticated API — they are
 * HOSTED-ONLY. Neither a database path nor the standard local opt-in is honoured by
 * these bins: client-side SQLite is reachable only through the
 * `@hasna/emails/storage` library seam, behind `HASNA_EMAILS_LOCAL=1`
 * (src/lib/local-opt-in.ts). The standalone `emails-serve` server retains its own
 * backend contract and is not a client fallback. Refusing up front, by name, is
 * what keeps a stale
 * export from ever turning a client run into an on-box one.
 */
export class ApiClientStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiClientStorageConfigurationError";
  }
}

export function assertApiClientStorage(env: NodeJS.ProcessEnv = process.env): void {
  const settings = ["HASNA_EMAILS_DB_PATH", "EMAILS_DB_PATH", ...EMAILS_LOCAL_OPT_IN_ENV_KEYS]
    .filter((name) => env[name]?.trim());
  if (settings.length) {
    throw new ApiClientStorageConfigurationError(
      `Emails CLI and MCP clients are hosted-only and require the authenticated Emails API. Unset ` +
        `${settings.join(" and ")} and configure HASNA_EMAILS_API_URL and HASNA_EMAILS_API_KEY, or use ` +
        `saved account credentials through emails auth, the Keychain item ${emailsKeychainItem("api-key")}, ` +
        `or ~/.hasna/emails/config/credentials. Local SQLite is opt-in only (${EMAILS_LOCAL_OPT_IN_ENV}=1) ` +
        `and automatic local selection is reachable only through createConfiguredEmailStore() — never from these clients. ` +
        `The standalone emails-serve server has a separate backend contract.`,
    );
  }
}
