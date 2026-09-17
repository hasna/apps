import { Store } from "./store";
import { createHandler } from "./service";
import { Fault } from "./domain";
import type { CatalogCredentialResolver } from "./catalog";
import { ApiKeyStore, type AuthAuditEvent } from "@hasna/contracts/auth";

export type ServerOptions = {
  apiKey?: string;
  signingSecret?: string;
  databaseUrl?: string;
  sqlitePath?: string;
  hostname?: string;
  port?: number;
  providerEnv?: Record<string, string | undefined>;
  resolveCredential?: CatalogCredentialResolver;
};

/** Owns only this listener and database connection; no global signal handlers. */
export async function startServer(options: ServerOptions) {
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Fault(400, "invalid_port", "Port must be an integer between 0 and 65535.");
  if (Boolean(options.apiKey) === Boolean(options.signingSecret))
    throw new Fault(500,"auth_config","Configure exactly one local API token or hosted API signing secret.");
  if (options.apiKey && (options.apiKey.length < 24 || /[\r\n]/.test(options.apiKey)))
    throw new Fault(500, "auth_config", "Use a random operator token of at least 24 characters.");
  if (options.signingSecret && (options.signingSecret.length < 32 || /[\r\n]/.test(options.signingSecret)))
    throw new Fault(500,"auth_config","Use an API signing secret of at least 32 characters.");
  if (options.signingSecret && !options.databaseUrl)
    throw new Fault(500,"storage_config","Hosted signed-key authentication requires PostgreSQL; configure HASNA_SWITCHER_DATABASE_URL.");
  const store = await Store.open({databaseUrl: options.databaseUrl, sqlitePath: options.sqlitePath, migrate:!options.signingSecret});
  let server;
  try {
    const authentication = options.apiKey ?? (() => {
      const keyStore = new ApiKeyStore(store.authQueryClient());
      return {kind:"signed-api-key" as const,signingSecret:options.signingSecret!,keyStatus:keyStore.keyStatus,audit:(event:AuthAuditEvent)=>{
        if(event.outcome==="deny")console.error(`api_auth deny kid=${event.kid??"-"} reason=${event.reason??"-"} ${event.method??"-"} ${event.path??"-"}`);
      }};
    })();
    server = Bun.serve({hostname: options.hostname ?? "127.0.0.1", port, maxRequestBodySize: 1024 * 1024,
      idleTimeout: 60, fetch: createHandler(store, authentication, options.providerEnv, options.resolveCredential)});
    await store.ready();
  } catch (error) {
    await server?.stop(true);
    await store.close();
    throw error;
  }
  const listener = server;
  let closing: Promise<void> | undefined;
  return {
    url: listener.url.href,
    storage: store.engine,
    close() {
      return closing ??= (async () => {
        try { await listener.stop(true); } finally { await store.close(); }
      })();
    },
  };
}
