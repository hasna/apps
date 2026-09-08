import { createClientTransport, type ClientEnv, type HasnaHttpTransport } from "../store/client.js";
import { guardedFetch } from "../test-isolation.js";
import { MigrationError } from "./snapshot.js";

/** Capture only a binding already validated by the shared request resolver.
 * In particular, never resolve a key separately from its destination URL.
 * Pointer completion and credential-source races stay in the shared resolver.
 */
export function migrationTransport(env: ClientEnv = process.env): HasnaHttpTransport {
  let binding: { origin: string; authorization: string; apiKey: string } | undefined;
  return createClientTransport("secrets", env, {
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      const headers = new Headers(init?.headers);
      const next = {
        origin: url.origin,
        authorization: headers.get("authorization") ?? "",
        apiKey: headers.get("x-api-key") ?? "",
      };
      if (!binding) {
        if ((init?.method ?? "GET") !== "GET" || !url.pathname.endsWith("/v1/migrations/vault") || !next.apiKey || !next.authorization) {
          throw new MigrationError("migration_capability_required");
        }
        binding = next;
      } else if (binding.origin !== next.origin || binding.authorization !== next.authorization || binding.apiKey !== next.apiKey) {
        throw new MigrationError("migration_destination_changed", 403);
      }
      return guardedFetch(input, init);
    },
  }).client;
}
