/**
 * `@hasna/logs/sdk` — the typed hosted-API client, resolver-backed.
 *
 * The canonical SDK subpath of the ONE `@hasna/logs` package (package-surfaces
 * rule, hasna/apps#1720 acceptance): the same generated `/v1` `LogsClient`
 * and `createLogsApiClientFromEnv` factory that `@hasna/logs/api` ships,
 * resolving the credential through the shared @hasna/contracts client chain
 * per request. `./api` stays as the historical alias of this surface.
 *
 *   import { createLogsApiClientFromEnv } from "@hasna/logs/sdk";
 *   const logs = createLogsApiClientFromEnv();
 *   await logs.ingestLog({ level: "info", message: "hello" });
 *
 * The bundle is self-contained (node builtins only): `src/sdk.test.ts` pins
 * that no bare package specifier survives the build.
 */

export * from "./api.ts";
