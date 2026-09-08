import { createIntakeClient, validateBinding, sourceIdentity } from "@hasna/events/intake";
import { EventsOutboxError, type SourceBinding, type EventsTarget } from "./events-outbox-store.js";

export interface ResolvedEventsIntake {
  target: EventsTarget;
  client: ReturnType<typeof createIntakeClient>;
}

/** Resolves only the server's Events credential chain. No request bearer enters it. */
export function resolveEventsIntake(source: SourceBinding, env: Record<string,string|undefined> = process.env): ResolvedEventsIntake {
  try { sourceIdentity(source.corpus_id); sourceIdentity(source.authority_id); }
  catch { throw new EventsOutboxError("events_source_identity_incompatible"); }
  try {
    const binding = validateBinding({sink_id:env.HASNA_CONVERSATIONS_EVENTS_SINK_ID,
      producer_id:env.HASNA_CONVERSATIONS_EVENTS_PRODUCER_ID,corpus_id:source.corpus_id,source_authority_id:source.authority_id});
    const client = createIntakeClient({binding,tenantId:source.tenant_id,env});
    const target = {sink_id:binding.sink_id,producer_id:binding.producer_id,url:client.baseUrl};
    return {target,client};
  } catch { throw new EventsOutboxError("events_intake_not_configured"); }
}
