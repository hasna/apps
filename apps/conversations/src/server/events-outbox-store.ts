import { randomUUID } from "node:crypto";
import { canonicalJson, envelopeHash, validateEnvelope, validateRequest, validateReceipt,
  INTAKE_PROTOCOL, CANONICAL_ENCODING, type IntakeRequest, type IntakeReceipt } from "@hasna/events/intake";
import type { EventEnvelope } from "@hasna/events";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import { readCorpusBinding, type CorpusBinding } from "./corpus-binding.js";
import type { EventDeliveryStatus } from "../lib/events-delivery.js";

export type SourceBinding = Pick<CorpusBinding, "corpus_id" | "tenant_id" | "authority_id">;
export interface EventsTarget { sink_id: string; producer_id: string; url: string }
export class EventsOutboxError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code); }
}
export interface DeliveryClaim {
  id: string; tenant_id: string; generation: string; lease_token: string;
  target: EventsTarget; request: IntakeRequest; external_may_exist: boolean;
}
interface DeliveryRow extends SourceBinding {
  outbox_id: string; envelope_sha256: string; dedupe_key: string;
  state: string; sink_id: string | null; producer_id: string | null; sink_url: string | null;
  generation: string; lease_token: string | null; attempts: number; external_may_exist: boolean;
}
const sameSource = (a: SourceBinding, b: SourceBinding) => a.tenant_id === b.tenant_id && a.corpus_id === b.corpus_id && a.authority_id === b.authority_id;
const sameTarget = (a: EventsTarget, b: EventsTarget) => a.sink_id === b.sink_id && a.producer_id === b.producer_id && a.url === b.url;

/** Capture inside the mutation transaction. Network configuration is not needed. */
export async function appendEventIntent(tx: TypedQueryClient, envelope: EventEnvelope): Promise<void> {
  const binding = await readCorpusBinding(tx);
  const serialized = JSON.stringify(envelope);
  let payload = serialized;
  let invalid = false;
  try { payload = canonicalJson(JSON.parse(serialized)); validateEnvelope(payload); }
  catch { invalid = true; }
  const hash = envelopeHash(payload);
  const state = invalid ? "quarantined" : "pending";
  await tx.execute("SET LOCAL synchronous_commit=on");
  const inserted = await tx.query(`INSERT INTO conversations_event_outbox(id,source,type,envelope_json,created_at,status,attempts)
    VALUES($1,$2,$3,$4,$5,$6,0) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [envelope.id,envelope.source,envelope.type,payload,envelope.time,state]);
  if (inserted.rowCount === 0) {
    const previous = await tx.get<DeliveryRow>("SELECT * FROM conversations_event_deliveries WHERE outbox_id=$1",[envelope.id]);
    if (!previous || !sameSource(previous,binding) || previous.envelope_sha256 !== hash) throw new EventsOutboxError("event_intent_conflict",409);
    return;
  }
  await tx.execute(`INSERT INTO conversations_event_deliveries(outbox_id,tenant_id,corpus_id,authority_id,envelope_sha256,dedupe_key,state,error_code)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[envelope.id,binding.tenant_id,binding.corpus_id,binding.authority_id,hash,
    typeof envelope.dedupeKey === "string" ? envelope.dedupeKey : envelope.id,state,invalid ? "invalid_envelope" : null]);
}

/** All mutations lock the source row before the ledger, matching redaction. */
export class EventsOutboxStore {
  constructor(private readonly client: PoolQueryClient, readonly source: SourceBinding) {}

  async ready(): Promise<void> {
    const r = await this.client.one<{ unsafe: boolean; rls: boolean }>(`SELECT
      (r.rolsuper OR r.rolbypassrls OR EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN
        ('conversations_event_deliveries'::regclass,'conversations_event_outbox'::regclass,'conversations_corpus_binding'::regclass,'api_keys'::regclass)
        AND pg_has_role(current_user,c.relowner,'MEMBER'))) unsafe,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='conversations_event_deliveries'::regclass) rls
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (r.unsafe || !r.rls) throw new EventsOutboxError("events_runtime_role_unsafe");
    const schema = await this.client.one<{ ready:boolean }>(`SELECT
      EXISTS(SELECT 1 FROM _migrations WHERE id=16)
      AND (SELECT COUNT(*)=3 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
        AND tgrelid IN ('conversations_event_deliveries'::regclass,'conversations_event_outbox'::regclass)
        AND tgname IN ('conversations_event_delivery_guard','conversations_event_delivery_no_truncate','conversations_event_delivery_invalidation')) ready`);
    if (!schema.ready) throw new EventsOutboxError("events_source_migration_required");
    const d = await this.client.one<{ fsync: string; full_page_writes: string }>("SELECT current_setting('fsync') fsync,current_setting('full_page_writes') full_page_writes");
    if (d.fsync !== "on" || d.full_page_writes !== "on") throw new EventsOutboxError("events_source_durability_unavailable");
    if (!sameSource(await readCorpusBinding(this.client),this.source)) throw new EventsOutboxError("events_source_binding_changed");
  }

  private async transaction<T>(fn: (tx: TypedQueryClient) => Promise<T>): Promise<T> {
    return this.client.transaction(async tx => {
      await tx.execute("SET LOCAL statement_timeout='5s'");
      await tx.execute("SET LOCAL lock_timeout='2s'");
      await tx.execute("SET LOCAL synchronous_commit=on");
      if (!sameSource(await readCorpusBinding(tx),this.source)) throw new EventsOutboxError("events_source_binding_changed");
      return fn(tx);
    });
  }

  private async quarantine(tx: TypedQueryClient, id: string, code: "source_changed" | "sink_changed" | "invalid_envelope"): Promise<void> {
    await tx.execute(`UPDATE conversations_event_deliveries SET state='quarantined',generation=generation+1,
      lease_token=NULL,lease_until=NULL,error_code=$2,reconciliation_required=reconciliation_required OR external_may_exist OR receipt IS NOT NULL,
      updated_at=clock_timestamp() WHERE outbox_id=$1`,[id,code]);
    await tx.execute("UPDATE conversations_event_outbox SET status='quarantined' WHERE id=$1",[id]);
  }

  async claim(target: EventsTarget, leaseMs: number): Promise<DeliveryClaim | "quarantined" | null> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 60_000) throw new EventsOutboxError("invalid_events_lease",400);
    return this.transaction(async tx => {
      const o = await tx.get<{id:string;envelope_json:string}>(`SELECT o.id,o.envelope_json FROM conversations_event_outbox o
        JOIN conversations_event_deliveries d ON d.outbox_id=o.id
        WHERE o.status='pending' AND ((d.state IN ('pending','retryable') AND d.next_attempt_at<=clock_timestamp())
          OR (d.state='leased' AND d.lease_until<=clock_timestamp()))
        ORDER BY d.created_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
      if (!o) return null;
      const d = await tx.one<DeliveryRow>("SELECT * FROM conversations_event_deliveries WHERE outbox_id=$1 FOR UPDATE",[o.id]);
      if (!sameSource(d,this.source) || envelopeHash(o.envelope_json) !== d.envelope_sha256) {
        await this.quarantine(tx,o.id,"source_changed"); return "quarantined";
      }
      if (d.sink_id !== null && !sameTarget(target,{sink_id:d.sink_id,producer_id:d.producer_id!,url:d.sink_url!})) {
        await this.quarantine(tx,o.id,"sink_changed"); return "quarantined";
      }
      let request: IntakeRequest;
      try { request = validateRequest({ protocol:INTAKE_PROTOCOL,encoding:CANONICAL_ENCODING,
        sink_id:target.sink_id,producer_id:target.producer_id,corpus_id:d.corpus_id,source_authority_id:d.authority_id,
        event_id:o.id,dedupe_key:d.dedupe_key,envelope_sha256:d.envelope_sha256,envelope_json:o.envelope_json }); }
      catch { await this.quarantine(tx,o.id,"invalid_envelope"); return "quarantined"; }
      const token = randomUUID();
      const leased = await tx.one<{generation:string}>(`UPDATE conversations_event_deliveries SET
        state='leased',sink_id=COALESCE(sink_id,$2::uuid),producer_id=COALESCE(producer_id,$3::uuid),sink_url=COALESCE(sink_url,$4),
        generation=generation+1,lease_token=$5,lease_until=clock_timestamp()+($6::double precision*interval '1 millisecond'),
        attempts=attempts+1,updated_at=clock_timestamp() WHERE outbox_id=$1 RETURNING generation`,
        [o.id,target.sink_id,target.producer_id,target.url,token,leaseMs]);
      return {id:o.id,tenant_id:d.tenant_id,generation:leased.generation,lease_token:token,target:{...target},request,
        external_may_exist:d.external_may_exist};
    });
  }

  private async current(tx: TypedQueryClient, claim: DeliveryClaim): Promise<boolean> {
    const o = await tx.get<{envelope_json:string}>("SELECT envelope_json FROM conversations_event_outbox WHERE id=$1 FOR UPDATE",[claim.id]);
    const d = await tx.get<DeliveryRow>(`SELECT * FROM conversations_event_deliveries WHERE outbox_id=$1
      AND state='leased' AND generation=$2 AND lease_token=$3 AND lease_until>clock_timestamp() FOR UPDATE`,
      [claim.id,claim.generation,claim.lease_token]);
    if (!o || !d) return false;
    if (!sameSource(d,this.source) || envelopeHash(o.envelope_json) !== claim.request.envelope_sha256) {
      await this.quarantine(tx,claim.id,"source_changed"); return false;
    }
    return d.envelope_sha256 === claim.request.envelope_sha256;
  }

  /** Durable dispatch intent precedes HTTP; interruption then requires reconciliation. */
  async beforeDispatch(claim: DeliveryClaim, target: EventsTarget): Promise<boolean> {
    return this.transaction(async tx => {
      if (!await this.current(tx,claim)) return false;
      if (!sameTarget(claim.target,target)) { await this.quarantine(tx,claim.id,"sink_changed"); return false; }
      const r = await tx.query(`UPDATE conversations_event_deliveries SET external_may_exist=TRUE,updated_at=clock_timestamp()
        WHERE outbox_id=$1 AND state='leased' AND generation=$2 AND lease_token=$3 AND lease_until>clock_timestamp()`,
        [claim.id,claim.generation,claim.lease_token]);
      return r.rowCount === 1;
    });
  }

  async complete(claim: DeliveryClaim, receipt: IntakeReceipt, target: EventsTarget = claim.target): Promise<boolean> {
    const reviewed = validateReceipt(receipt,claim.request,claim.tenant_id);
    return this.transaction(async tx => {
      if (!await this.current(tx,claim)) return false;
      if (!sameTarget(claim.target,target)) {
        await this.quarantine(tx,claim.id,"sink_changed");
        await tx.execute("UPDATE conversations_event_deliveries SET receipt=$2::jsonb,reconciliation_required=TRUE WHERE outbox_id=$1 AND receipt IS NULL",
          [claim.id,JSON.stringify(reviewed)]);
        return false;
      }
      const r = await tx.query(`UPDATE conversations_event_deliveries SET state='accepted',receipt=$4::jsonb,
        lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=clock_timestamp()
        WHERE outbox_id=$1 AND state='leased' AND generation=$2 AND lease_token=$3 AND lease_until>clock_timestamp()`,
        [claim.id,claim.generation,claim.lease_token,JSON.stringify(reviewed)]);
      if (r.rowCount !== 1) return false;
      await tx.execute("UPDATE conversations_event_outbox SET status='accepted' WHERE id=$1",[claim.id]);
      return true;
    });
  }

  async retry(claim: DeliveryClaim): Promise<boolean> {
    return this.transaction(async tx => {
      if (!await this.current(tx,claim)) return false;
      const r = await tx.query(`UPDATE conversations_event_deliveries SET state='retryable',error_code='unconfirmed_intake',
        lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+least(300,power(2,least(attempts,8))) * interval '1 second',
        updated_at=clock_timestamp() WHERE outbox_id=$1 AND state='leased' AND generation=$2 AND lease_token=$3 AND lease_until>clock_timestamp()`,
        [claim.id,claim.generation,claim.lease_token]);
      return r.rowCount === 1;
    });
  }

  async inspect(id: string): Promise<EventDeliveryStatus | null> {
    if (!id || id.length > 512 || /[\x00-\x1f\x7f]/.test(id)) throw new EventsOutboxError("invalid_event_id",400);
    return this.transaction(tx => tx.get<EventDeliveryStatus>(`SELECT outbox_id,tenant_id,corpus_id,authority_id,
      envelope_sha256,state,sink_id,producer_id,generation::text,attempts,external_may_exist,reconciliation_required,
      receipt->>'receipt_id' receipt_id,receipt->>'accepted_at' accepted_at,error_code
      FROM conversations_event_deliveries WHERE outbox_id=$1`,[id]));
  }

}
