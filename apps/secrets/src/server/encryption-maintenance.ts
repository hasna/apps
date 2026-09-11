import { randomBytes } from "node:crypto";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { ENCRYPTION_TABLES, type EncryptionReceipt, type EncryptionCounts } from "../encryption-maintenance.js";
import { decryptValueWithMetadata, encryptValue, isEncrypted } from "./cloud-crypto.js";

const COLUMNS = {secrets:"value",vault_items:"data",secret_versions:"value_blob",vault_migrations:"manifest"} as const;
const KEYS = {secrets:["key"],vault_items:["id"],secret_versions:["key","version"],vault_migrations:["id"]} as const;
export class EncryptionMaintenanceError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
/** Caller supplies a repeatable-read, tenant-scoped transaction. No plaintext leaves it. */
export async function inspectEncryption(db: TypedQueryClient, tenant: string, repair: boolean): Promise<EncryptionReceipt> {
  const nonce = randomBytes(32).toString("hex");
  if (decryptValueWithMetadata(encryptValue(nonce)).value !== nonce) throw new EncryptionMaintenanceError("runtime_key_verification_failed",503);
  const sizes = await db.many<{rows:number;bytes:number}>(ENCRYPTION_TABLES.map(t=>`SELECT count(*)::int rows, coalesce(sum(octet_length(${COLUMNS[t]})),0)::float8 bytes FROM ${t}`).join(" UNION ALL "));
  if (sizes.reduce((n,s)=>n+s.rows,0)>10000 || sizes.reduce((n,s)=>n+s.bytes,0)>64*1024*1024) throw new EncryptionMaintenanceError("encryption_inspection_limit_exceeded",413);
  const tables = {} as EncryptionReceipt["tables"];
  const changes: {sql:string;params:(string|number)[]}[] = [];
  for (const table of ENCRYPTION_TABLES) {
    const field=COLUMNS[table], keys=KEYS[table];
    const rows=await db.many<Record<string,string|number>>(`SELECT ${keys.join(",")},${field} FROM ${table} ORDER BY ${keys.join(",")}${repair?" FOR UPDATE":""}`);
    const counts: EncryptionCounts={total:rows.length,plaintext:0,active:0,previous:0,unreadable:0,repaired:0};
    tables[table]=counts;
    for(const row of rows) {
      const stored=String(row[field]);
      if(!isEncrypted(stored)) {
        // Unknown encryption versions must never be silently wrapped as plaintext.
        if(stored.startsWith("enc:")) {counts.unreadable++;continue;}
        counts.plaintext++;
        if(repair) {
          const encrypted=encryptValue(stored);
          if(decryptValueWithMetadata(encrypted).value!==stored) throw new EncryptionMaintenanceError("encryption_readback_failed");
          changes.push({sql:`UPDATE ${table} SET ${field}=$1 WHERE ${keys.map((k,i)=>`${k}=$${i+2}`).join(" AND ")} RETURNING ${field} AS payload`,params:[encrypted,...keys.map(k=>row[k]!)]});
          counts.plaintext--;counts.active++;counts.repaired++;
        }
      } else {
        try { const result=decryptValueWithMetadata(stored);counts[result.needsReencryption?"previous":"active"]++; }
        catch {counts.unreadable++;}
      }
    }
  }
  if(repair && ENCRYPTION_TABLES.some(t=>tables[t].unreadable)) throw new EncryptionMaintenanceError("encrypted_payload_unreadable");
  for(const change of changes) {
    const written = await db.get<{payload:string}>(change.sql,change.params);
    if (!written || written.payload !== change.params[0]) throw new EncryptionMaintenanceError("encryption_write_not_verified");
  }
  return {protocol:"secrets-encryption-v1",tenant_id:tenant,complete:true,inspected_at:new Date().toISOString(),verified:ENCRYPTION_TABLES.every(t=>!tables[t].plaintext&&!tables[t].unreadable),runtime_key:{verified:true,mechanism:"injected_master_key",kms:"unattested"},tables};
}
