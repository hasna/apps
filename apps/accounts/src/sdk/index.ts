// Public SDK surface for @hasna/accounts, generated from the accounts-serve
// OpenAPI document (see src/server/openapi.ts). Import via `@hasna/accounts/sdk`.
//
// Client convention: ACCOUNTS_API_URL + ACCOUNTS_API_KEY (never a DSN). The
// generated client speaks the Hasna auth convention (x-api-key).

export * from "./client.js";
import { AccountsClient, type AccountsClientOptions } from "./client.js";

export interface AccountsClientEnvOptions extends Partial<AccountsClientOptions> {
  env?: NodeJS.ProcessEnv;
}

/**
 * Build an {@link AccountsClient} from the environment.
 * Reads ACCOUNTS_API_URL and ACCOUNTS_API_KEY (overridable via options).
 */
export function createAccountsClientFromEnv(options: AccountsClientEnvOptions = {}): AccountsClient {
  const env = options.env ?? process.env;
  const baseUrl = options.baseUrl ?? env.ACCOUNTS_API_URL;
  if (!baseUrl) {
    throw new Error("createAccountsClientFromEnv requires ACCOUNTS_API_URL (or options.baseUrl).");
  }
  // hasna-credential-seam-waiver: SDK factory hands the key to the generated AccountsClient (x-api-key header); the contracts-client seam migration is a tracked follow-up requiring a contracts runtime upgrade.
  const apiKey = options.apiKey ?? env.ACCOUNTS_API_KEY;
  return new AccountsClient({
    baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
  });
}
