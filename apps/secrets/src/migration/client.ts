import { createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { openSync, fstatSync, readFileSync, closeSync, constants } from "node:fs";
import { resolveSecretsStorageClient, resolveCredential } from "../store/client.js";
import { readSnapshot, proof, MigrationError, TABLES } from "./snapshot.js";

/** Deliberately separate from getMasterKey(): migration must never create/rewrap a key. */
export function readExistingKey(path: string): Buffer {
  if(!path.startsWith('/')) throw new MigrationError('explicit_key_file_required');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=fstatSync(fd);
    if(!st.isFile() || st.size>128 || (st.mode&0o077)!==0) throw new MigrationError('private_key_file_required');
    const raw=readFileSync(fd,'utf8').trim();
    if(!/^[a-f0-9]{64}$/i.test(raw)) throw new MigrationError('unsupported_local_key_format');
    return Buffer.from(raw,'hex');
  } finally {closeSync(fd);}
}
export interface KmsUnwrapper { decrypt(input: {keyId:string;ciphertext:Buffer;region:string}): Promise<Uint8Array> }
const sdkUnwrapper: KmsUnwrapper = { async decrypt(input) {
  const {KMSClient,DecryptCommand}=await import('@aws-sdk/client-kms');
  const kms=new KMSClient({region:input.region,maxAttempts:1});
  try {const result=await kms.send(new DecryptCommand({KeyId:input.keyId,CiphertextBlob:input.ciphertext,EncryptionAlgorithm:'SYMMETRIC_DEFAULT'}),{abortSignal:AbortSignal.timeout(15000)});if(!result.Plaintext)throw new Error('unavailable');return result.Plaintext;} finally {kms.destroy();}
}};
export async function readExistingKmsKey(path: string, keyId: string, region: string, unwrap: KmsUnwrapper = sdkUnwrapper): Promise<Buffer> {
  if(!path.startsWith('/') || !keyId.trim() || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new MigrationError('invalid_kms_source_reference');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  let blob:Buffer;
  try {const st=fstatSync(fd);if(!st.isFile() || st.size>16384 || (st.mode&0o077)!==0)throw new MigrationError('private_key_file_required');blob=readFileSync(fd);} finally {closeSync(fd);}
  try {
    const plaintext=await unwrap.decrypt({keyId,ciphertext:blob,region});
    if(plaintext.length!==32){plaintext.fill(0);throw new MigrationError('kms_source_key_unavailable');}
    const key=Buffer.from(plaintext);plaintext.fill(0);return key;
  } catch {throw new MigrationError('kms_source_key_unavailable');} finally {blob.fill(0);}
}
export function decryptWithKey(stored:string,key:Buffer):string {
  if(!stored.startsWith('enc:'))return stored;
  const match=/^enc:v1:([a-f0-9]{24}):([a-f0-9]+)$/i.exec(stored);
  if(!match || match[2]!.length<32 || match[2]!.length%2)throw new MigrationError('invalid_source_ciphertext');
  const data=Buffer.from(match[2]!,'hex');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(match[1]!,'hex'));
  decipher.setAuthTag(data.subarray(-16));return Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString('utf8');
}
export async function migrateVault(args: string[]) {
  const opts:Record<string,string>={};
  for(let i=0;i<args.length;i+=2) {
    const flag=args[i];const val=args[i+1];
    if(!flag || !['--source','--key-file','--source-id','--migration-id','--tenant','--kms-key-id','--kms-region'].includes(flag) || !val || opts[flag])throw new MigrationError('migration_requires_source_key_file_source_id_migration_id_tenant');
    opts[flag]=val;
  }
  if(!['--source','--key-file','--source-id','--migration-id','--tenant'].every(k=>opts[k]) || !!opts['--kms-key-id']!==!!opts['--kms-region'])throw new MigrationError('migration_requires_source_key_file_source_id_migration_id_tenant');
  if(!['--source-id','--migration-id','--tenant'].every(k=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(opts[k]!)))throw new MigrationError('invalid_migration_identity');
  const credential=resolveCredential('secrets',process.env);if(!credential)throw new MigrationError('migration_credential_required');
  const {client}=resolveSecretsStorageClient('secrets',process.env,{credentials:{apiKey:credential.apiKey}});const url=new URL(client.baseUrl);
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','[::1]','localhost'].includes(url.hostname)))throw new MigrationError('migration_requires_https');
  // Capability and destination identity verified BEFORE opening either source file.
  const capability=await client.transport.get<{protocol:string;tenant_id:string;kid:string;tables:string[]}>('/migrations/vault',{retry:false});
  if(typeof capability.kid!=='string' || !capability.kid || capability.protocol!=='secrets-lossless-v1' || capability.tenant_id!==opts['--tenant'] || [...capability.tables].sort().join()!==[...TABLES].sort().join())throw new MigrationError('migration_capability_or_tenant_mismatch');
  const key=opts['--kms-key-id'] ? await readExistingKmsKey(opts['--key-file']!,opts['--kms-key-id']!,opts['--kms-region']!) : readExistingKey(opts['--key-file']!);
  try {
    const snapshot=readSnapshot(opts['--source']!,value=>decryptWithKey(value,key));
    const nonce=randomBytes(32).toString('hex');const expected=proof(snapshot,nonce);
    const receipt=await client.transport.post<{protocol:string;tenant_id:string;migration_id:string;source_id:string;verified:boolean;proof:string;counts:Record<string,number>;replayed:boolean;deletion_authorized:boolean}>('/migrations/vault',{
      expected_tenant_id:capability.tenant_id,expected_kid:capability.kid,migration_id:opts['--migration-id'],source_id:opts['--source-id'],nonce,snapshot,
    },{idempotencyKey:opts['--migration-id'],headers:{'x-secrets-migration-tenant':capability.tenant_id,'x-secrets-migration-kid':capability.kid},retry:false,timeoutMs:120000});
    if(!TABLES.every(t=>receipt.counts?.[t]===snapshot.tables[t].length) || receipt.protocol!=='secrets-lossless-v1' || receipt.tenant_id!==opts['--tenant'] || receipt.migration_id!==opts['--migration-id'] || receipt.source_id!==opts['--source-id'] || !receipt.verified || !/^[a-f0-9]{64}$/.test(receipt.proof) || !timingSafeEqual(Buffer.from(receipt.proof,'hex'),Buffer.from(expected,'hex'))) throw new MigrationError('migration_receipt_not_verified');
    if(proof(readSnapshot(opts['--source']!,value=>decryptWithKey(value,key)),nonce)!==expected) throw new MigrationError('source_changed_during_migration');
    // Do not render the nonce, keyed proof, source manifest or any server error payload.
    return {migration_id:receipt.migration_id,source_id:receipt.source_id,tenant_id:receipt.tenant_id,verified:true,replayed:receipt.replayed,counts:receipt.counts,deletion_authorized:false};
  } finally {key.fill(0);}
}
