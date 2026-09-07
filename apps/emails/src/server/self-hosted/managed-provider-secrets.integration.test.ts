import {beforeAll,afterAll,expect,test} from "bun:test";
import {randomBytes} from "node:crypto";
import {createPgPool,createQueryClient,MigrationLedger,type PoolQueryClient} from "../../storage-kit/index.js";
import {emailsSelfHostedMigrations,DEFAULT_TENANT_ID} from "./migrations.js";
import {ManagedProviderSecrets} from "./managed-provider-secrets.js";
import {sealProviderBytes,openProviderBytes,type ProviderRootKms,type SealedBytes} from "./managed-provider-crypto.js";
const url=process.env.EMAILS_TEST_POSTGRES_URL;let db:PoolQueryClient;
const other="00000000-0000-4000-8000-000000000036",master=randomBytes(32);let failDecrypt=false;
const kms:ProviderRootKms={generate:async context=>{const plain=randomBytes(32);return{plaintext:plain,ciphertext:Buffer.from(JSON.stringify(sealProviderBytes(plain,master,JSON.stringify(context))))};},decrypt:async(cipher,context)=>{if(failDecrypt)throw Error("Synthetic KMS outage");return openProviderBytes(JSON.parse(cipher.toString()) as SealedBytes,master,JSON.stringify(context));}};
const run=test.skipIf(!url);
beforeAll(async()=>{if(!url)return;db=createQueryClient(createPgPool({connectionString:url,env:{PGSSLMODE:"disable"}}));await db.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");await new MigrationLedger(db,emailsSelfHostedMigrations()).migrate();await db.execute("INSERT INTO tenants(id,name,slug,status) VALUES($1,'Other','managed-other','active')",[other]);},60000);
afterAll(async()=>{await db?.close();});
async function provider(id:string,tenant=DEFAULT_TENANT_ID){await db.execute("INSERT INTO self_hosted_providers(id,tenant_id,name,type,active) VALUES($1,$2,$1,'resend',true)",[id,tenant]);}
run("tenant/provider/revision-bound envelopes keep provider plaintext out of PostgreSQL",async()=>{
 const own=new ManagedProviderSecrets(db,DEFAULT_TENANT_ID,kms,0),foreign=new ManagedProviderSecrets(db,other,kms);await provider("managed-first");
 const credentials={type:"resend" as const,api_key:"synthetic-credential-"+crypto.randomUUID()};const saved=await own.install("managed-first",credentials,null,"fixture");expect(saved.revision).toBe(1);expect(await db.one("SELECT actor FROM provider_credential_audit WHERE provider_id='managed-first'")).toEqual({actor:"fixture"});expect((await own.metadata()).envelopes[0]).toMatchObject({provider_id:"managed-first",revision:1,root_id:saved.root_id});expect((await own.read("managed-first"))?.credentials).toEqual(credentials);
 const dump=await db.one("SELECT row_to_json(e)::text AS value FROM provider_credential_envelopes e WHERE provider_id='managed-first'");expect(JSON.stringify(dump)).not.toContain(credentials.api_key);
 await db.execute("UPDATE tenants SET status='suspended' WHERE id=$1",[other]);try{await expect(foreign.metadata()).rejects.toThrow("not active");}finally{await db.execute("UPDATE tenants SET status='active' WHERE id=$1",[other]);}
 expect(await foreign.read("managed-first")).toBeNull();await expect(foreign.install("managed-first",credentials,null,"fixture")).rejects.toThrow("registered");await expect(own.install("managed-first",credentials,null,"fixture")).rejects.toThrow("revision changed");
 await db.execute("UPDATE self_hosted_providers SET type='ses' WHERE id='managed-first'");try{await expect(own.read("managed-first")).rejects.toThrow("type changed");}finally{await db.execute("UPDATE self_hosted_providers SET type='resend' WHERE id='managed-first'");}
 const root=await db.one<{wrapped_root:string;id:string}>("SELECT wrapped_root,id FROM provider_secret_roots WHERE tenant_id=$1 AND state='active'",[DEFAULT_TENANT_ID]);await expect(kms.decrypt(Buffer.from(root.wrapped_root,"base64"),{app:"emails",tenant:other,root:root.id,purpose:"provider-root"},AbortSignal.timeout(1000))).rejects.toThrow();
});
run("rotation resumes bounded batches, preserves payload ciphertext and never double-counts concurrent advance",async()=>{
 const store=new ManagedProviderSecrets(db,DEFAULT_TENANT_ID,kms,0);for(const id of ["managed-second","managed-third"]){await provider(id);await store.install(id,{type:"resend",api_key:"synthetic-"+id},null,"fixture");}
 const before=await db.many<{provider_id:string;payload:unknown;root_id:string}>("SELECT provider_id,payload,root_id FROM provider_credential_envelopes ORDER BY provider_id"),key=crypto.randomUUID();
 const job=await new ManagedProviderSecrets(db,DEFAULT_TENANT_ID,kms).begin("rotate-root",key,"fixture");expect(job.status).toBe("pending");expect(job.remaining).toBe(3);expect((await store.begin("rotate-root",key,"fixture")).id).toBe(job.id);
 await expect(store.begin("rewrap",key,"fixture")).rejects.toThrow("conflicts");await expect(store.begin("revoke-root",crypto.randomUUID(),"fixture",before[0]!.root_id)).rejects.toThrow("pending");
 const batch=await store.advance(job.id,1);expect(batch.processed).toBe(1);expect(batch.remaining).toBe(2);
 await Promise.all([store.advance(job.id,1),store.advance(job.id,1)]);const complete=await store.getJob(job.id);expect(complete).toMatchObject({status:"complete",processed:3,remaining:0});
 const after=await db.many<{provider_id:string;payload:unknown;root_id:string}>("SELECT provider_id,payload,root_id FROM provider_credential_envelopes ORDER BY provider_id");expect(after.map(row=>row.payload)).toEqual(before.map(row=>row.payload));expect(after.every(row=>row.root_id===job.root_id)).toBe(true);
 await expect(store.begin("revoke-root",crypto.randomUUID(),"fixture",before[0]!.root_id)).rejects.toThrow("retained");
 await db.execute("UPDATE provider_secret_roots SET revoke_after=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",[DEFAULT_TENANT_ID,before[0]!.root_id]);
 const revokeKey=crypto.randomUUID();const revoked=await store.begin("revoke-root",revokeKey,"fixture",before[0]!.root_id);expect(revoked.status).toBe("complete");expect((await store.begin("revoke-root",revokeKey,"fixture",before[0]!.root_id)).id).toBe(revoked.id);
 expect((await store.read("managed-second"))?.credentials.api_key).toBe("synthetic-managed-second");await expect(store.begin("revoke-root",crypto.randomUUID(),"fixture",job.root_id)).rejects.toThrow("active");
});
run("KMS failure rolls back a batch and later resumes without losing provider readability",async()=>{
 const store=new ManagedProviderSecrets(db,DEFAULT_TENANT_ID,kms,0),job=await store.begin("rotate-root",crypto.randomUUID(),"fixture");const before=await store.getJob(job.id);
 failDecrypt=true;try{await expect(store.advance(job.id)).rejects.toThrow("KMS outage");}finally{failDecrypt=false;}
 expect(await store.getJob(job.id)).toEqual(before);expect((await store.read("managed-third"))?.credentials.api_key).toBe("synthetic-managed-third");expect((await store.advance(job.id)).status).toBe("complete");
});
run("credential updates during rotation use the new root and revision fences prevent lost updates",async()=>{
 const store=new ManagedProviderSecrets(db,DEFAULT_TENANT_ID,kms,0),job=await store.begin("rotate-root",crypto.randomUUID(),"fixture");const saved=await store.install("managed-second",{type:"resend",api_key:"synthetic-updated"},1,"fixture");expect(saved.root_id).toBe(job.root_id);expect(saved.revision).toBe(2);
 const updates=await Promise.allSettled([store.install("managed-second",{type:"resend",api_key:"synthetic-next-one"},2,"fixture"),store.install("managed-second",{type:"resend",api_key:"synthetic-next-two"},2,"fixture")]);expect(updates.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect((await store.advance(job.id)).status).toBe("complete");
});
run("unprivileged RLS hides every foreign credential table and rejects cross-tenant root insertion",async()=>{
 const role="managed_review_"+crypto.randomUUID().replaceAll("-","");await db.execute(`CREATE ROLE "${role}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE ON provider_secret_roots,provider_secret_state,provider_credential_envelopes,provider_secret_jobs,provider_credential_audit TO "${role}"`);
 try{
  await db.transaction(async tx=>{await tx.execute(`SET LOCAL ROLE "${role}"`);await tx.execute("SELECT set_config('app.current_tenant',$1,true)",[other]);for(const table of ["provider_secret_roots","provider_secret_state","provider_credential_envelopes","provider_secret_jobs","provider_credential_audit"]){expect(await tx.many(`SELECT * FROM ${table}`)).toEqual([]);expect(await tx.many(`UPDATE ${table} SET tenant_id=tenant_id RETURNING tenant_id`)).toEqual([]);}});
  await expect(db.transaction(async tx=>{await tx.execute(`SET LOCAL ROLE "${role}"`);await tx.execute("SELECT set_config('app.current_tenant',$1,true)",[other]);await tx.execute("INSERT INTO provider_secret_roots(tenant_id,id,wrapped_root,state) VALUES($1,$2,'fixture','available')",[DEFAULT_TENANT_ID,crypto.randomUUID()]);})).rejects.toThrow(/row.level security/i);
 }finally{await db.execute(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);}
});
