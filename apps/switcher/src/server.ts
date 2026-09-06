import { Store } from "./store";
import { createHandler } from "./service";
import { Fault } from "./domain";
import type { CatalogCredentialResolver } from "./catalog";

export type ServerOptions = {
  apiKey: string;
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
  if (options.apiKey.length < 24 || /[\r\n]/.test(options.apiKey))
    throw new Fault(500, "auth_config", "Use a random operator token of at least 24 characters.");
  const store = await Store.open({databaseUrl: options.databaseUrl, sqlitePath: options.sqlitePath});
  let server;
  try {
    server = Bun.serve({hostname: options.hostname ?? "127.0.0.1", port, maxRequestBodySize: 1024 * 1024,
      idleTimeout: 60, fetch: createHandler(store, options.apiKey, options.providerEnv, options.resolveCredential)});
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
