import { randomUUID } from "node:crypto";
import { ENCRYPTION_TABLES, type EncryptionReceipt } from "../src/encryption-maintenance.js";
export function encryptionReceipt(): EncryptionReceipt {
  return {protocol:"secrets-encryption-v1",tenant_id:randomUUID(),complete:true,inspected_at:new Date().toISOString(),verified:true,runtime_key:{verified:true,mechanism:"injected_master_key",kms:"unattested"},tables:Object.fromEntries(ENCRYPTION_TABLES.map(t=>[t,{total:1,active:1,previous:0,plaintext:0,unreadable:0,repaired:0}])) as EncryptionReceipt["tables"]};
}
