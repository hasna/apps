import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { COLUMNS, TABLES, readSnapshot, proof } from "../src/migration/snapshot.js";

test("all six tables are preserved, including old identities and metadata, without modifying source", () => {
 const dir=mkdtempSync(join(tmpdir(),"synthetic-vault-")); const path=join(dir,"source.db");
 try {
  const db=new Database(path);
  for(const table of TABLES) db.exec(`CREATE TABLE ${table} (${COLUMNS[table].map(c=>`${c} TEXT`).join(',')})`);
  for(const table of TABLES) {
   const values=COLUMNS[table].map(c=>['value','data','value_blob'].includes(c)?'ciphertext':c==='version'?'1':c==='value_length'?'4':c==='id'?'original-id':c==='key'?'fixture-key':null);
   db.query(`INSERT INTO ${table} VALUES (${values.map(()=>'?').join(',')})`).run(...values);
  }
  db.close();const before=statSync(path).mtimeMs;
  const snapshot=readSnapshot(path,()=> 'synthetic-value');
  expect(TABLES.map(t=>snapshot.tables[t].length)).toEqual([1,1,1,1,1,1]);
  expect(snapshot.tables.vault_items[0]!.id).toBe('original-id');
  expect(snapshot.tables.secret_versions[0]!.value_blob).toBe('synthetic-value');
  const nonce=randomBytes(32).toString('hex');expect(proof(snapshot,nonce)).toHaveLength(64);
  expect(statSync(path).mtimeMs).toBe(before);
  expect(()=>readSnapshot(path,()=>{throw new Error('must not disclose ciphertext or key');})).toThrow('source_decryption_failed');
  const edit=new Database(path);edit.exec('ALTER TABLE feedback ADD COLUMN legacy_extra TEXT');edit.close();
  expect(()=>readSnapshot(path,x=>x)).toThrow('unsupported_source_columns');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test("KMS migration only unwraps existing ciphertext in memory and never rewrites source key",async()=>{
 const {readExistingKmsKey}=await import('../src/migration/client.js');
 const {writeFileSync,readFileSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'synthetic-kms-'));const path=join(dir,'vault.key.enc');
 const blob=randomBytes(64);writeFileSync(path,blob,{mode:0o600});
 const plain=randomBytes(32);const expected=Buffer.from(plain);let calls=0;
 try {
  const result=await readExistingKmsKey(path,'fixture-key-id','us-east-1',{async decrypt(input){calls++;expect(input.keyId).toBe('fixture-key-id');expect(input.ciphertext.equals(blob)).toBe(true);return plain;}});
  expect(result.equals(expected)).toBe(true);expect(plain.every(n=>n===0)).toBe(true);expect(calls).toBe(1);expect(readFileSync(path).equals(blob)).toBe(true);result.fill(0);expected.fill(0);
  await expect(readExistingKmsKey(path,'fixture-key-id','us-east-1',{async decrypt(){throw new Error('sensitive provider detail');}})).rejects.toThrow('kms_source_key_unavailable');
 } finally {rmSync(dir,{recursive:true,force:true});}
});
