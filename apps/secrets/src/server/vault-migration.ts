import { COLUMNS, TABLES, MAX_SNAPSHOT_BYTES, MigrationError, canonical, proof, validateSnapshot, type Row, type Snapshot, type Table } from "../migration/snapshot.js";
import { encryptValue, decryptValue, fingerprintValue } from "./cloud-crypto.js";
import { setTenantContext } from "./tenant-client.js";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/index.js";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const MIGRATION_PROTOCOL = "secrets-lossless-v1";
export interface MigrationPrincipal { tenantId: string; kid: string }
function identity(table: Table, row: Row) {
  return table === "secret_versions" ? { sql: "key=$1 AND version=$2", args: [row.key, row.version] } : { sql: `${table === "secrets" ? "key" : "id"}=$1`, args: [row[table === "secrets" ? "key" : "id"]] };
}
async function fence(db: TypedQueryClient, a: MigrationPrincipal) {
  await setTenantContext(db,a.tenantId);
  const key = await db.get("SELECT k.kid FROM api_keys k JOIN tenants t ON t.id=k.tenant_id WHERE k.kid=$1 AND k.tenant_id=$2 AND t.status='active' AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now()) AND (k.scopes ? 'secrets:migrate' OR k.scopes ? 'secrets:*' OR k.scopes ? '*') FOR SHARE OF k,t", [a.kid, a.tenantId]);
  if (!key) throw new MigrationError("migration_authority_changed",403);
}
export async function migrationCapability(client: PoolQueryClient, a: MigrationPrincipal) {
  await client.transaction(async db => {
    await fence(db,a);
    // This read requires the migration ledger to exist; no fake capability on old schema.
    await db.get("SELECT id FROM vault_migrations WHERE tenant_id=$1 LIMIT 1",[a.tenantId]);
  });
  return { protocol: MIGRATION_PROTOCOL, tenant_id: a.tenantId, kid: a.kid, max_bytes: MAX_SNAPSHOT_BYTES, tables: TABLES, atomic: true, deletion_authorized: false };
}
async function readback(db: TypedQueryClient, tenant: string, expected: Snapshot, signal: AbortSignal): Promise<Snapshot> {
  const tables = {} as Snapshot['tables'];
  for (const table of TABLES) {
    tables[table]=[];
    for (const original of expected.tables[table]) {
      signal.throwIfAborted();
      const id=identity(table,original);
      const row=await db.get<Row>(`SELECT ${COLUMNS[table].join(',')} FROM ${table} WHERE ${id.sql} AND tenant_id=$${id.args.length+1}`, [...id.args,tenant]);
      if (!row) throw new MigrationError('migration_readback_missing',409);
      // pg bigint uses strings; SQLite safe integers retain their original representation.
      if(table==='audit_log' && typeof original.id==='number') row.id=Number(row.id);
      const field=table==='secrets'?'value':table==='vault_items'?'data':table==='secret_versions'?'value_blob':undefined;
      if(field) row[field]=decryptValue(String(row[field]));
      if(table==='secret_versions') {
        if(row.value_hash!==fingerprintValue(String(row.value_blob))) throw new MigrationError('migration_history_fingerprint_changed',409);
        row.value_hash=original.value_hash; // original local-key fingerprint remains encrypted in provenance.
      }
      if(canonical(row)!==canonical(original)) throw new MigrationError('migration_readback_conflict',409);
      tables[table].push(row);
    }
  }
  const sequence=await db.get<{last_value:string}>('SELECT last_value FROM audit_log_id_seq');
  if(!sequence || Number(sequence.last_value)<expected.audit_sequence)throw new MigrationError('migration_sequence_readback_conflict',409);
  return {schema:1,audit_sequence:expected.audit_sequence,tables};
}
export async function importVault(client: PoolQueryClient, a: MigrationPrincipal, input: unknown, parentSignal?: AbortSignal) {
  const signal=parentSignal ? AbortSignal.any([parentSignal,AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
  signal.throwIfAborted();
  if(!input || typeof input!=='object') throw new MigrationError('invalid_migration_request');
  const v=input as {expected_tenant_id:string;expected_kid:string;migration_id:string;source_id:string;nonce:string;snapshot:Snapshot};
  if(Object.keys(v).sort().join()!=='expected_kid,expected_tenant_id,migration_id,nonce,snapshot,source_id' || !UUID.test(v.migration_id) || !UUID.test(v.source_id)) throw new MigrationError('invalid_migration_identity');
  if(v.expected_tenant_id!==a.tenantId || v.expected_kid!==a.kid)throw new MigrationError('migration_destination_changed',403);
  const snapshot=validateSnapshot(v.snapshot);proof(snapshot,v.nonce);
  return client.transaction(async db=>{
    await db.execute("SET LOCAL statement_timeout='10s'");
    await db.execute("SET LOCAL lock_timeout='5s'");
    await db.execute("SET LOCAL synchronous_commit='on'");
    const durable=await db.get<{fsync:string;full_page_writes:string;synchronous_commit:string}>("SELECT current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes,current_setting('synchronous_commit') AS synchronous_commit");
    if(durable?.fsync!=='on'||durable.full_page_writes!=='on'||durable.synchronous_commit!=='on')throw new MigrationError('migration_durability_unavailable',503);
    await fence(db,a);
    // Blocks ordinary INSERT/UPDATE/DELETE while checking global identities and readback.
    await db.execute('LOCK TABLE secrets,vault_items,audit_log,users,feedback,secret_versions,vault_migrations,vault_migration_keys IN SHARE ROW EXCLUSIVE MODE');
    const prior=await db.get<{manifest:string;source_id:string}>("SELECT manifest,source_id FROM vault_migrations WHERE tenant_id=$1 AND id=$2",[a.tenantId,v.migration_id]);
    if(prior) {
      if(prior.source_id!==v.source_id || decryptValue(prior.manifest)!==canonical(snapshot)) throw new MigrationError('migration_replay_conflict',409);
    } else {
      for(const table of TABLES) for(const row of snapshot.tables[table]) {
        signal.throwIfAborted();
        const id=identity(table,row);
        if(await db.get(`SELECT 1 FROM ${table} WHERE ${id.sql}`,id.args)) throw new MigrationError('migration_destination_identity_conflict',409);
      }
      for(const row of snapshot.tables.secrets) if(await db.get('SELECT 1 FROM secret_versions WHERE key=$1',[row.key])) throw new MigrationError('migration_destination_identity_conflict',409);
      // Global history keys may be owned by a destination secret even if no version collides.
      for(const row of snapshot.tables.secret_versions) if(!snapshot.tables.secrets.some(s=>s.key===row.key) && await db.get('SELECT 1 FROM secrets WHERE key=$1',[row.key])) throw new MigrationError('migration_destination_identity_conflict',409);
      for(const table of TABLES) for(const original of snapshot.tables[table]) {
        signal.throwIfAborted();
        const row={...original};const field=table==='secrets'?'value':table==='vault_items'?'data':table==='secret_versions'?'value_blob':undefined;
        if(field) row[field]=encryptValue(String(row[field]));
        if(table==='secret_versions') row.value_hash=fingerprintValue(String(original.value_blob));
        const columns:string[]=[...COLUMNS[table]];const values:unknown[]=columns.map(k=>row[k]);
        columns.push('tenant_id');values.push(a.tenantId);
        await db.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')})`,values);
      }
      // Avoid an AUTOINCREMENT collision after preserving source audit identifiers.
      await db.execute("SELECT setval(pg_get_serial_sequence('audit_log','id'), GREATEST(COALESCE((SELECT MAX(id) FROM audit_log),1),(SELECT last_value FROM audit_log_id_seq),$1::bigint),true)",[snapshot.audit_sequence]);
      await db.execute('INSERT INTO vault_migrations(id,tenant_id,source_id,manifest) VALUES($1,$2,$3,$4)',[v.migration_id,a.tenantId,v.source_id,encryptValue(canonical(snapshot))]);
      for(const key of new Set(snapshot.tables.secret_versions.map(row=>String(row.key)))) await db.execute('INSERT INTO vault_migration_keys(tenant_id,migration_id,key) VALUES($1,$2,$3)',[a.tenantId,v.migration_id,key]);
    }
    const verified=await readback(db,a.tenantId,snapshot,signal);
    signal.throwIfAborted();
    return {protocol:MIGRATION_PROTOCOL,migration_id:v.migration_id,source_id:v.source_id,tenant_id:a.tenantId,replayed:!!prior,verified:true,proof:proof(verified,v.nonce),counts:Object.fromEntries(TABLES.map(t=>[t,verified.tables[t].length])),deletion_authorized:false};
  }).catch((e: unknown) => {
    if(e && typeof e==='object' && 'code' in e && e.code==='23505')throw new MigrationError('migration_destination_identity_conflict',409);
    throw e;
  });
}
/** Bound request bodies before JSON parsing; never surface provider/SQL error text. */
export async function readMigrationBody(req: Request): Promise<unknown> {
  if(!req.body) throw new MigrationError('missing_migration_body');
  const reader=req.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>MAX_SNAPSHOT_BYTES+4096)throw new MigrationError('snapshot_byte_limit',413);chunks.push(next.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch(e){if(e instanceof MigrationError)throw e;throw new MigrationError('invalid_migration_json');}
  finally {await reader.cancel().catch(()=>{});}
}
