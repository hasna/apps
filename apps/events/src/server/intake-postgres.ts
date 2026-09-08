import { randomUUID } from "node:crypto";
import { ApiKeyStore, type ApiKeyPrincipal } from "@hasna/contracts/auth";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { INTAKE_PROTOCOL, IntakeError, boundedText, uuid, validateBinding, validateRequest, type IntakeBinding, type IntakeReceipt, type IntakeRequest } from "../intake/protocol.js";

export function authQueries(pool: Pick<Pool, "query">) {
  return {
    async many<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]> { return (await pool.query<T>(sql, params ? [...params] : undefined)).rows; },
    async get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T | null> { return (await pool.query<T>(sql, params ? [...params] : undefined)).rows[0] ?? null; },
    async execute(sql: string, params?: readonly unknown[]): Promise<void> { await pool.query(sql, params ? [...params] : undefined); },
  };
}
export async function tenantTransaction<T>(pool: Pool, tenant: string, run: (c: PoolClient) => Promise<T>): Promise<T> {
  boundedText(tenant, 256);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL synchronous_commit=on");
    await c.query("SET LOCAL statement_timeout='10000'");
    await c.query("SET LOCAL lock_timeout='5000'");
    await c.query("SELECT set_config('events.tenant_id',$1,true)", [tenant]);
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}

export class IntakePostgres {
  readonly keys: ApiKeyStore;
  constructor(readonly pool: Pool, readonly expectedSinkId: string, readonly expectedAuthorityId: string) {
    uuid(expectedSinkId); uuid(expectedAuthorityId);
    this.keys = new ApiKeyStore(authQueries(pool));
  }
  /** Fail closed on owner/superuser/BYPASSRLS service credentials or a wrong sink. */
  async ready(): Promise<void> {
    const { rows } = await this.pool.query(`SELECT r.rolsuper,r.rolbypassrls,
      EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=current_schema()::regnamespace AND c.relname LIKE 'events_%' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns
      FROM pg_roles r WHERE rolname=current_user`);
    if (!rows[0] || rows[0].rolsuper || rows[0].rolbypassrls || rows[0].owns) throw new IntakeError("runtime_role_must_not_own_intake", 503);
    const durability = await this.pool.query("SELECT current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes");
    if (durability.rows[0]?.fsync !== "on" || durability.rows[0]?.full_page_writes !== "on") throw new IntakeError("intake_durable_postgres_required", 503);
    const policies = await this.pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname IN ('events_producer_bindings','events_producer_key_grants','events_intake_records')");
    if (policies.rows.length !== 3 || policies.rows.some(r => !r.relrowsecurity || !r.relforcerowsecurity)) throw new IntakeError("intake_row_security_required", 503);
    const identity = await this.pool.query("SELECT sink_id,authority_id,protocol FROM events_intake_identity");
    if (identity.rows.length !== 1 || identity.rows[0].sink_id !== this.expectedSinkId || identity.rows[0].authority_id !== this.expectedAuthorityId || identity.rows[0].protocol !== INTAKE_PROTOCOL) throw new IntakeError("intake_not_initialized_for_authority", 503);
  }
  private async authorize(c: PoolClient, principal: ApiKeyPrincipal, binding: IntakeBinding): Promise<void> {
    // Lock the same key/producer/grant rows operator revocations update. Authority
    // is rechecked even for historical receipts, before any return or insert.
    if (binding.sink_id !== this.expectedSinkId) throw new IntakeError("sink_mismatch", 409);
    const key = await c.query(`SELECT kid FROM api_keys WHERE kid=$1 AND app='events' AND tid=$2
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE`, [principal.kid, principal.tid]);
    const producer = await c.query(`SELECT app,corpus_id,source_authority_id FROM events_producer_bindings
      WHERE producer_id=$1 AND tenant_id=$2 AND active FOR SHARE`, [binding.producer_id, principal.tid]);
    const grant = await c.query(`SELECT kid FROM events_producer_key_grants
      WHERE producer_id=$1 AND tenant_id=$2 AND kid=$3 AND active FOR SHARE`, [binding.producer_id, principal.tid, principal.kid]);
    const p = producer.rows[0];
    if (!key.rows.length || !p || !grant.rows.length || p.corpus_id !== binding.corpus_id || p.source_authority_id !== binding.source_authority_id) throw new IntakeError("producer_not_authorized", 403);
  }
  private receipt(row: QueryResultRow, binding: IntakeBinding, tenant: string): IntakeReceipt {
    return { ...binding, protocol: INTAKE_PROTOCOL, tenant_id: tenant, event_id: row.event_id, dedupe_key: row.dedupe_key, envelope_sha256: row.envelope_sha256, receipt_id: row.receipt_id, accepted_at: new Date(row.accepted_at).toISOString(), status: "accepted_durable" };
  }
  async capability(principal: ApiKeyPrincipal, binding: IntakeBinding) {
    await this.ready(); validateBinding(binding);
    if (!principal.tid) throw new IntakeError("tenant_required", 403);
    return tenantTransaction(this.pool, principal.tid, async c => {
      await this.authorize(c, principal, binding);
      return { protocol: INTAKE_PROTOCOL, ...binding, tenant_id: principal.tid!, kid: principal.kid };
    });
  }
  async accept(principal: ApiKeyPrincipal, raw: unknown): Promise<IntakeReceipt> {
    await this.ready();
    const request = validateRequest(raw);
    if (!principal.tid) throw new IntakeError("tenant_required", 403);
    return tenantTransaction(this.pool, principal.tid, async c => {
      await this.authorize(c, principal, request);
      const producer = await c.query("SELECT app FROM events_producer_bindings WHERE producer_id=$1", [request.producer_id]);
      if (JSON.parse(request.envelope_json).source !== producer.rows[0]?.app) throw new IntakeError("producer_source_mismatch", 403);
      // Serialize BOTH unique identities; ON CONFLICT plus readback handles
      // event-id and dedupe-key collisions without rewriting existing evidence.
      await c.query(`INSERT INTO events_intake_records(tenant_id,producer_id,event_id,dedupe_key,envelope_sha256,envelope_json,receipt_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [principal.tid,request.producer_id,request.event_id,request.dedupe_key,request.envelope_sha256,request.envelope_json,randomUUID()]);
      const rows = await c.query(`SELECT event_id,dedupe_key,envelope_sha256,receipt_id,accepted_at FROM events_intake_records
        WHERE tenant_id=$1 AND producer_id=$2 AND (event_id=$3 OR dedupe_key=$4)`, [principal.tid,request.producer_id,request.event_id,request.dedupe_key]);
      const row = rows.rows[0];
      if (rows.rows.length !== 1 || row.event_id !== request.event_id || row.dedupe_key !== request.dedupe_key || row.envelope_sha256 !== request.envelope_sha256) throw new IntakeError("event_identity_conflict", 409);
      return this.receipt(row, validateBinding(request), principal.tid!);
    });
  }
  async read(principal: ApiKeyPrincipal, binding: IntakeBinding, eventId: string): Promise<IntakeReceipt> {
    await this.ready(); validateBinding(binding); boundedText(eventId);
    if (!principal.tid) throw new IntakeError("tenant_required", 403);
    return tenantTransaction(this.pool, principal.tid, async c => {
      await this.authorize(c, principal, binding);
      const rows = await c.query("SELECT event_id,dedupe_key,envelope_sha256,receipt_id,accepted_at FROM events_intake_records WHERE tenant_id=$1 AND producer_id=$2 AND event_id=$3", [principal.tid,binding.producer_id,eventId]);
      if (!rows.rows[0]) throw new IntakeError("receipt_not_found", 404);
      return this.receipt(rows.rows[0], binding, principal.tid!);
    });
  }
}
