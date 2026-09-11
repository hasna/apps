// One expensive message search per API process. Admission happens in the store
// so saved-filter and other listMessages callers share the same database budget.
import type { TypedQueryClient, PoolQueryClient } from "../../storage-kit/index.js";

export class MessageSearchBusyError extends Error {
  constructor() { super("Message search is busy; retry later."); this.name = "MessageSearchBusyError"; }
}

export class MessageSearchTimeoutError extends Error {
  constructor() { super("Message search exceeded its time limit."); this.name = "MessageSearchTimeoutError"; }
}

let activeSearches = 0;

export async function runMessageListQuery<T>(options: {
  search?: string;
  tenantId: string;
  scopedClient: TypedQueryClient;
  atomicClient?: PoolQueryClient;
  query: (client: TypedQueryClient) => Promise<T>;
}): Promise<T> {
  // Match listMessages' existing search predicate exactly. Ordinary reads never
  // acquire this permit and continue using their existing tenant-scoped client.
  if (!options.search?.trim()) return options.query(options.scopedClient);
  if (activeSearches >= 1) throw new MessageSearchBusyError();
  activeSearches++;
  try {
    if (!options.atomicClient) return await options.query(options.scopedClient);
    return await options.atomicClient.transaction(async (tx) => {
      await tx.execute("SELECT set_config('app.current_tenant', $1, true)", [options.tenantId]);
      // PostgreSQL cancels the actual work; a client-side Promise timeout would
      // release admission while its expensive query still consumed database CPU.
      // SET LOCAL resets on commit/rollback and never changes a later send/read.
      await tx.execute("SET LOCAL statement_timeout = '30s'");
      return options.query(tx);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "57014") {
      throw new MessageSearchTimeoutError();
    }
    throw error;
  } finally {
    activeSearches--;
  }
}

export function messageSearchErrorResponse(error: unknown): Response | null {
  if (!(error instanceof MessageSearchBusyError) && !(error instanceof MessageSearchTimeoutError)) return null;
  const busy = error instanceof MessageSearchBusyError;
  return new Response(JSON.stringify({
    error: error.message,
    code: busy ? "search_busy" : "search_timeout",
  }), {
    status: busy ? 429 : 504,
    headers: { "Content-Type": "application/json", "Retry-After": "5", "Cache-Control": "no-store" },
  });
}
