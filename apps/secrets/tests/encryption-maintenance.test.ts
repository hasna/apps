import {test,expect} from "bun:test";
import {inspectEncryption} from "../src/server/encryption-maintenance.js";
import {encryptValue,_resetCloudMasterKey} from "../src/server/cloud-crypto.js";
import {validateEncryptionReceipt} from "../src/encryption-maintenance.js";
import {encryptionReceipt} from "./encryption-fixture.js";
import {randomBytes,randomUUID} from "node:crypto";
import type {TypedQueryClient} from "../src/generated/storage-kit/index.js";

test("inspection limits and unknown envelopes fail before writes",async()=>{
 const old=process.env.HASNA_SECRETS_MASTER_KEY;process.env.HASNA_SECRETS_MASTER_KEY=randomBytes(32).toString("hex");_resetCloudMasterKey();
 try {
  for(const sizes of [[{rows:10001,bytes:0}],[{rows:1,bytes:64*1024*1024+1}]]) {
   let calls=0;const db={many:async()=>{calls++;return sizes;}} as unknown as TypedQueryClient;
   await expect(inspectEncryption(db,randomUUID(),true)).rejects.toThrow("inspection_limit");expect(calls).toBe(1);
  }
  let writes=0;
  const db={many:async(sql:string)=>sql.includes("UNION ALL")?[{rows:1,bytes:20}]:sql.includes("FROM secrets ")?[{key:"fixture",value:"enc:v99:opaque"}]:[],get:async()=>{writes++;return {};}} as unknown as TypedQueryClient;
  await expect(inspectEncryption(db,randomUUID(),true)).rejects.toThrow("encrypted_payload_unreadable");expect(writes).toBe(0);
 } finally {if(old===undefined)delete process.env.HASNA_SECRETS_MASTER_KEY;else process.env.HASNA_SECRETS_MASTER_KEY=old;_resetCloudMasterKey();}
});
test("receipt rejects incomplete or inconsistent evidence and strips unrecognized fields",()=>{
 const receipt=encryptionReceipt();
 expect(validateEncryptionReceipt({...receipt,extra:"untrusted"})).not.toHaveProperty("extra");
 for(const bad of [{...receipt,complete:false},{...receipt,verified:false},{...receipt,tables:{}},{...receipt,runtime_key:{verified:false}}])expect(()=>validateEncryptionReceipt(bad)).toThrow();
});
test("previous runtime keys authenticate existing ciphertext without rotating it",async()=>{
 const old=process.env.HASNA_SECRETS_MASTER_KEY, previous=process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS;
 const former=randomBytes(32).toString("hex");
 try {
  process.env.HASNA_SECRETS_MASTER_KEY=former;_resetCloudMasterKey();const payload=encryptValue("synthetic");
  process.env.HASNA_SECRETS_MASTER_KEY=randomBytes(32).toString("hex");process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS=JSON.stringify([former]);_resetCloudMasterKey();
  let writes=0;const db={many:async(sql:string)=>sql.includes("UNION ALL")?[{rows:1,bytes:payload.length}]:sql.includes("FROM secrets ")?[{key:"fixture",value:payload}]:[],get:async()=>{writes++;return {};}} as unknown as TypedQueryClient;
  const result=await inspectEncryption(db,randomUUID(),true);
  expect(result.verified).toBe(true);expect(result.tables.secrets.previous).toBe(1);expect(result.tables.secrets.repaired).toBe(0);expect(writes).toBe(0);
 } finally {
  if(old===undefined)delete process.env.HASNA_SECRETS_MASTER_KEY;else process.env.HASNA_SECRETS_MASTER_KEY=old;
  if(previous===undefined)delete process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS;else process.env.HASNA_SECRETS_PREVIOUS_MASTER_KEYS=previous;_resetCloudMasterKey();
 }
});
