import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import { EventsOutboxError, EventsOutboxStore, type SourceBinding } from "./events-outbox-store.js";
import { resolveEventsIntake, type ResolvedEventsIntake } from "./events-intake-client.js";
import type { EventsDrainReceipt } from "../lib/events-delivery.js";

export type DrainEventOutboxResult = EventsDrainReceipt;
export interface DrainEventOutboxOptions {
  signal: AbortSignal;
  /** Re-authenticates the source caller and reads the persisted corpus binding. */
  authorizeSource: () => Promise<SourceBinding>;
  resolveIntake?: (source: SourceBinding) => ResolvedEventsIntake;
}

/** Bounded PostgreSQL claim/HTTP/ack cycles. No transaction spans network I/O. */
export async function drainServerEventOutbox(client: PoolQueryClient, limit = 20, options: DrainEventOutboxOptions): Promise<DrainEventOutboxResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new EventsOutboxError("invalid_events_drain_limit",400);
  const signal = AbortSignal.any([options.signal,AbortSignal.timeout(25_000)]);
  signal.throwIfAborted();
  const source = await options.authorizeSource();
  const store = new EventsOutboxStore(client,source);
  await store.ready();
  const resolve = options.resolveIntake ?? resolveEventsIntake;
  // Missing configuration refuses before reserving any source work.
  resolve(source);
  const result: DrainEventOutboxResult = {protocol:"conversations.events-delivery.v1",scanned:0,accepted:0,retryable:0,
    quarantined:0,lost_claim:0,transported:0,skipped:0,spooled:0};
  const reauthorize = async () => {
    const fresh = await options.authorizeSource();
    if (fresh.tenant_id !== source.tenant_id || fresh.corpus_id !== source.corpus_id || fresh.authority_id !== source.authority_id)
      throw new EventsOutboxError("events_source_binding_changed");
  };
  for (let n=0;n<limit && !signal.aborted;n++) {
    await reauthorize();
    signal.throwIfAborted();
    const resolved = resolve(source);
    const claim = await store.claim(resolved.target,30_000);
    if (!claim) break;
    result.scanned++;
    if (claim === "quarantined") { result.quarantined++; result.skipped++; continue; }
    try {
      signal.throwIfAborted();
      await reauthorize();
      const current = resolve(source);
      if (!await store.beforeDispatch(claim,current.target)) { result.lost_claim++; continue; }
      signal.throwIfAborted();
      const ioSignal = AbortSignal.any([signal,AbortSignal.timeout(10_000)]);
      let receipt;
      if (claim.external_may_exist) {
        try { receipt = await current.client.receipt(claim.request,ioSignal); }
        catch (error) {
          // An authenticated, exact-identity miss permits replay; other readback
          // failures retain the same uncertain intent without another write.
          if (!(error && typeof error === "object" && "status" in error && error.status === 404)) throw error;
        }
      }
      if (!receipt) {
        // Receipt lookup is a separate network round trip. Redaction, revocation
        // or destination drift during that lookup must fence the replay too.
        await reauthorize();
        const replay = resolve(source);
        if (!await store.beforeDispatch(claim,replay.target)) { result.lost_claim++; continue; }
        ioSignal.throwIfAborted();
        receipt = await replay.client.accept(claim.request,ioSignal);
      }
      await reauthorize();
      if (await store.complete(claim,receipt,resolve(source).target)) { result.accepted++; result.transported++; }
      else result.lost_claim++;
    } catch {
      if (await store.retry(claim)) result.retryable++;
      else result.lost_claim++;
    }
  }
  return result;
}
