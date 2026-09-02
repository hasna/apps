import { createPgPool } from "../server-storage/pool";
import { createQueryClient } from "../server-storage/query";
import { resolveServerDatabase } from "../server-storage/backend";
export { resolveServerDatabase };

export function createServerPool(env: NodeJS.ProcessEnv = process.env) {
  const connectionString = resolveServerDatabase(env);
  return createQueryClient(createPgPool({ connectionString, env, connectionTimeoutMillis: 10_000, applicationName: "attachments-serve" }));
}
