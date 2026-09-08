/** Public, value-free evidence for the four encrypted tenant payload columns. */
export const ENCRYPTION_TABLES = ["secrets", "vault_items", "secret_versions", "vault_migrations"] as const;
export type EncryptionTable = typeof ENCRYPTION_TABLES[number];
export interface EncryptionCounts { total: number; plaintext: number; active: number; previous: number; unreadable: number; repaired: number }
export interface EncryptionReceipt {
  protocol: "secrets-encryption-v1";
  tenant_id: string;
  complete: true;
  inspected_at: string;
  verified: boolean;
  runtime_key: { verified: true; mechanism: "injected_master_key"; kms: "unattested" };
  tables: Record<EncryptionTable, EncryptionCounts>;
}
export function validateEncryptionReceipt(value: unknown): EncryptionReceipt {
  const r = value as EncryptionReceipt;
  if (!r || r.protocol !== "secrets-encryption-v1" || r.complete !== true || typeof r.tenant_id !== "string" || !/^[a-f0-9-]{36}$/i.test(r.tenant_id) || !Number.isFinite(Date.parse(r.inspected_at)) || typeof r.verified !== "boolean" || r.runtime_key?.verified !== true || r.runtime_key.mechanism !== "injected_master_key" || r.runtime_key.kms !== "unattested") throw new Error("Invalid encryption verification receipt; upgrade the Secrets API");
  for (const table of ENCRYPTION_TABLES) {
    const c = r.tables?.[table];
    if (!c || ![c.total,c.plaintext,c.active,c.previous,c.unreadable,c.repaired].every(n=>Number.isSafeInteger(n)&&n>=0) || c.total !== c.plaintext+c.active+c.previous+c.unreadable || c.repaired > c.active) throw new Error("Incomplete encryption verification receipt");
  }
  if (r.verified !== ENCRYPTION_TABLES.every(t=>r.tables[t].plaintext===0 && r.tables[t].unreadable===0)) throw new Error("Inconsistent encryption verification receipt");
  if (ENCRYPTION_TABLES.reduce((n,t)=>n+r.tables[t].total,0)>10000) throw new Error("Encryption receipt exceeds inspection limit");
  return {protocol:r.protocol,tenant_id:r.tenant_id,complete:true,inspected_at:r.inspected_at,verified:r.verified,runtime_key:{verified:true,mechanism:"injected_master_key",kms:"unattested"},tables:Object.fromEntries(ENCRYPTION_TABLES.map(t=>{const c=r.tables[t];return [t,{total:c.total,plaintext:c.plaintext,active:c.active,previous:c.previous,unreadable:c.unreadable,repaired:c.repaired}];})) as EncryptionReceipt["tables"]};
}

const countSchema = {type:"object",additionalProperties:false,required:["total","plaintext","active","previous","unreadable","repaired"],properties:Object.fromEntries(["total","plaintext","active","previous","unreadable","repaired"].map(k=>[k,{type:"integer",minimum:0}]))};
export const ENCRYPTION_RECEIPT_SCHEMA = {type:"object",additionalProperties:false,required:["protocol","tenant_id","complete","inspected_at","verified","runtime_key","tables"],properties:{protocol:{type:"string",enum:["secrets-encryption-v1"]},tenant_id:{type:"string",format:"uuid"},complete:{type:"boolean",enum:[true]},inspected_at:{type:"string",format:"date-time"},verified:{type:"boolean"},runtime_key:{type:"object",required:["verified","mechanism","kms"],properties:{verified:{type:"boolean",enum:[true]},mechanism:{type:"string",enum:["injected_master_key"]},kms:{type:"string",enum:["unattested"]}}},tables:{type:"object",required:ENCRYPTION_TABLES,properties:Object.fromEntries(ENCRYPTION_TABLES.map(t=>[t,countSchema]))}}};
