import {createHash,randomBytes,randomUUID} from "node:crypto";
import type {PoolQueryClient,TypedQueryClient} from "../../storage-kit/index.js";
import {openProviderBytes,sealProviderBytes,providerSecretAad,validateManagedProviderCredentials,type ManagedProviderCredentials,type ProviderRootKms,type SealedBytes} from "./managed-provider-crypto.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface RootRow {id:string;wrapped_root:string|null;state:"active"|"available"|"revoked";revoke_after?:string|Date|null}
interface EnvelopeRow {provider_active?:boolean;provider_region?:string|null;provider_type?:string;provider_id:string;root_id:string;revision:number;payload:SealedBytes;wrapped_dek:SealedBytes}
export interface ProviderSecretJob {id:string;operation:"rewrap"|"rotate-root"|"revoke-root";status:"pending"|"complete";root_id:string;processed:number;remaining:number}
export class ManagedProviderSecretError extends Error {constructor(message:string,readonly status=409){super(message);}}
/** Tenant-scoped, transactional envelope lifecycle. KMS never receives provider payloads. */
export class ManagedProviderSecrets {
 constructor(private readonly pool:PoolQueryClient,readonly tenant:string,private readonly kms:ProviderRootKms,private readonly retentionMs=7*86400000){if(!Number.isSafeInteger(retentionMs)||retentionMs<0||retentionMs>365*86400000)throw new Error("Invalid provider root retention policy");}
 get configured(){return this.kms.configured!==false;}
 private validateActor(actor:string){if(typeof actor!=="string"||!actor.trim()||actor.length>256||/[\x00-\x1f\x7f]/.test(actor))throw new ManagedProviderSecretError("An opaque authenticated actor identifier is required",400);}
 private async transaction<T>(action:(tx:TypedQueryClient,signal:AbortSignal)=>Promise<T>):Promise<T>{
  const signal=AbortSignal.timeout(10000);
  return this.pool.transaction(async tx=>{await tx.execute("SELECT set_config('app.current_tenant',$1,true)",[this.tenant]);await tx.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");if(!await tx.get("SELECT id FROM tenants WHERE id=$1 AND status='active' FOR SHARE",[this.tenant]))throw new ManagedProviderSecretError("Tenant is not active",403);return action(tx,signal);});
 }
 private context(root:string){return{app:"emails" as const,tenant:this.tenant,root,purpose:"provider-root" as const};}
 private async state(tx:TypedQueryClient):Promise<string|null>{
  await tx.execute("INSERT INTO provider_secret_state(tenant_id) VALUES($1) ON CONFLICT DO NOTHING",[this.tenant]);
  return (await tx.one<{active_root_id:string|null}>("SELECT active_root_id FROM provider_secret_state WHERE tenant_id=$1 FOR UPDATE",[this.tenant])).active_root_id;
 }
 private async createRoot(tx:TypedQueryClient,signal:AbortSignal):Promise<string>{
  const id=randomUUID(),material=await this.kms.generate(this.context(id),signal);
  try{
   if(material.plaintext.length!==32||!material.ciphertext.length)throw new ManagedProviderSecretError("KMS did not return a usable tenant root",503);
   await tx.execute("UPDATE provider_secret_roots SET state='available',revoke_after=now()+($2::double precision*interval '1 millisecond') WHERE tenant_id=$1 AND state='active'",[this.tenant,this.retentionMs]);
   await tx.execute("INSERT INTO provider_secret_roots(tenant_id,id,wrapped_root,state) VALUES($1,$2,$3,'active')",[this.tenant,id,material.ciphertext.toString("base64")]);
   await tx.execute("UPDATE provider_secret_state SET active_root_id=$2,generation=generation+1 WHERE tenant_id=$1",[this.tenant,id]);return id;
  }finally{material.plaintext.fill(0);}
 }
 private async rootKey(tx:TypedQueryClient,id:string,signal:AbortSignal):Promise<Buffer>{
  const row=await tx.get<RootRow>("SELECT id,wrapped_root,state FROM provider_secret_roots WHERE tenant_id=$1 AND id=$2 FOR SHARE",[this.tenant,id]);
  if(!row||row.state==="revoked"||!row.wrapped_root)throw new ManagedProviderSecretError("Provider root is unavailable");
  const key=await this.kms.decrypt(Buffer.from(row.wrapped_root,"base64"),this.context(id),signal);
  if(key.length!==32){key.fill(0);throw new ManagedProviderSecretError("KMS did not return a usable tenant root",503);}return key;
 }
 async install(provider:string,input:unknown,expectedRevision:number|null,actor:string):Promise<{provider_id:string;revision:number;root_id:string}>{
  this.validateActor(actor);
  if(expectedRevision!==null&&(!Number.isInteger(expectedRevision)||expectedRevision<1))throw new ManagedProviderSecretError("Expected credential revision must be null or a positive integer",400);
  const credentials=validateManagedProviderCredentials(input);
  return this.transaction(async(tx,signal)=>{
   let root=await this.state(tx);
   const registered=await tx.get<{type:string;active:boolean}>("SELECT type,active FROM self_hosted_providers WHERE tenant_id=$1 AND id=$2 FOR SHARE",[this.tenant,provider]);
   if(!registered||!registered.active||registered.type!==credentials.type)throw new ManagedProviderSecretError("Active provider is not registered with this type in the tenant",404);
   const prior=await tx.get<EnvelopeRow>("SELECT * FROM provider_credential_envelopes WHERE tenant_id=$1 AND provider_id=$2 FOR UPDATE",[this.tenant,provider]);
   if((prior?.revision??null)!==expectedRevision)throw new ManagedProviderSecretError("Provider credential revision changed; read status before updating");
   root??=await this.createRoot(tx,signal);
   const revision=(prior?.revision??0)+1,rootKey=await this.rootKey(tx,root,signal),dek=randomBytes(32),plaintext=Buffer.from(JSON.stringify(credentials));
   try{
    const payload=sealProviderBytes(plaintext,dek,providerSecretAad(this.tenant,provider,revision,"payload")),wrapped=sealProviderBytes(dek,rootKey,providerSecretAad(this.tenant,provider,revision,"dek"));
    await tx.execute("INSERT INTO provider_credential_envelopes(tenant_id,provider_id,root_id,revision,payload,wrapped_dek) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT(tenant_id,provider_id) DO UPDATE SET root_id=excluded.root_id,revision=excluded.revision,payload=excluded.payload,wrapped_dek=excluded.wrapped_dek,updated_at=now()",[this.tenant,provider,root,revision,JSON.stringify(payload),JSON.stringify(wrapped)]);
    await tx.execute("INSERT INTO provider_credential_audit(tenant_id,id,provider_id,root_id,revision,actor) VALUES($1,$2,$3,$4,$5,$6)",[this.tenant,randomUUID(),provider,root,revision,actor]);
    return{provider_id:provider,revision,root_id:root};
   }finally{plaintext.fill(0);dek.fill(0);rootKey.fill(0);}
  });
 }
 async read(provider:string):Promise<{credentials:ManagedProviderCredentials;revision:number;region:string|null}|null>{
  return this.transaction(async(tx,signal)=>{
   // Same state lock ordering as writers/revocation prevents key retirement during unwrap.
   await tx.get("SELECT active_root_id FROM provider_secret_state WHERE tenant_id=$1 FOR UPDATE",[this.tenant]);
   if(!await tx.get("SELECT id FROM self_hosted_providers WHERE tenant_id=$1 AND id=$2 AND active=true FOR SHARE",[this.tenant,provider]))throw new ManagedProviderSecretError("Provider is not active or registered in this tenant");
   const row=await tx.get<EnvelopeRow>("SELECT e.*,p.active AS provider_active,p.type AS provider_type,p.region AS provider_region FROM provider_credential_envelopes e JOIN self_hosted_providers p ON p.tenant_id=e.tenant_id AND p.id=e.provider_id WHERE e.tenant_id=$1 AND e.provider_id=$2 FOR SHARE OF e,p",[this.tenant,provider]);
   if(!row)return null;
   if(row.provider_active===false)throw new ManagedProviderSecretError("Managed provider is inactive");
   const root=await this.rootKey(tx,row.root_id,signal);let dek:Buffer|undefined,plain:Buffer|undefined;
   try{dek=openProviderBytes(row.wrapped_dek,root,providerSecretAad(this.tenant,provider,row.revision,"dek"));plain=openProviderBytes(row.payload,dek,providerSecretAad(this.tenant,provider,row.revision,"payload"));const credentials=validateManagedProviderCredentials(JSON.parse(plain.toString()));if(credentials.type!==row.provider_type)throw new ManagedProviderSecretError("Provider type changed after credential installation");return{credentials,revision:row.revision,region:row.provider_region??null};}
   finally{root.fill(0);dek?.fill(0);plain?.fill(0);}
  });
 }
 async begin(operation:ProviderSecretJob["operation"],idempotencyKey:string,actor:string,revokeRoot?:string):Promise<ProviderSecretJob>{
  this.validateActor(actor);
  if(!UUID.test(idempotencyKey))throw new ManagedProviderSecretError("A reusable UUID idempotency key is required",400);
  if(operation==="revoke-root"&&(!revokeRoot||!UUID.test(revokeRoot)))throw new ManagedProviderSecretError("A tenant root UUID is required",400);
  const hash=createHash("sha256").update(JSON.stringify([operation,revokeRoot??null])).digest("hex");
  return this.transaction(async(tx,signal)=>{
   let root=await this.state(tx);
   const prior=await tx.get<ProviderSecretJob&{input_hash:string}>("SELECT * FROM provider_secret_jobs WHERE tenant_id=$1 AND idempotency_key=$2",[this.tenant,idempotencyKey]);
   if(prior){if(prior.input_hash!==hash)throw new ManagedProviderSecretError("Lifecycle idempotency key conflicts with another request");return this.job(tx,prior.id);}
   if(await tx.get("SELECT id FROM provider_secret_jobs WHERE tenant_id=$1 AND status='pending' LIMIT 1",[this.tenant]))throw new ManagedProviderSecretError("Finish the pending credential lifecycle job first");
   let status:"pending"|"complete"="pending";
   if(operation==="revoke-root"){
    if(root===revokeRoot)throw new ManagedProviderSecretError("The active provider root cannot be revoked");
    const existing=await tx.get<RootRow>("SELECT * FROM provider_secret_roots WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[this.tenant,revokeRoot]);
    if(!existing)throw new ManagedProviderSecretError("Provider root does not exist in this tenant",404);
    if(existing.revoke_after&&new Date(existing.revoke_after).getTime()>Date.now())throw new ManagedProviderSecretError("Provider root is retained for the recovery window; revoke after "+new Date(existing.revoke_after).toISOString());
    if(await tx.get("SELECT provider_id FROM provider_credential_envelopes WHERE tenant_id=$1 AND root_id=$2 LIMIT 1",[this.tenant,revokeRoot]))throw new ManagedProviderSecretError("Provider root is still referenced; rewrap first");
    await tx.execute("UPDATE provider_secret_roots SET state='revoked',wrapped_root=NULL WHERE tenant_id=$1 AND id=$2",[this.tenant,revokeRoot]);root=revokeRoot!;status="complete";
   }else if(operation==="rotate-root"){root=await this.createRoot(tx,signal);}
   else if(!root)throw new ManagedProviderSecretError("No active tenant root; install credentials or rotate-root first");
   const id=randomUUID();
   await tx.execute("INSERT INTO provider_secret_jobs(tenant_id,id,idempotency_key,input_hash,operation,status,root_id,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[this.tenant,id,idempotencyKey,hash,operation,status,root,actor]);
   return this.job(tx,id);
  });
 }
 private async job(tx:TypedQueryClient,id:string):Promise<ProviderSecretJob>{
  if(!UUID.test(id))throw new ManagedProviderSecretError("A lifecycle job UUID is required",400);
  const row=await tx.get<Omit<ProviderSecretJob,"remaining">>("SELECT id,operation,status,root_id,processed FROM provider_secret_jobs WHERE tenant_id=$1 AND id=$2",[this.tenant,id]);
  if(!row)throw new ManagedProviderSecretError("Provider secret job does not exist in this tenant",404);
  const remaining=row.status==="complete"||row.operation==="revoke-root"?0:(await tx.one<{count:number}>("SELECT count(*)::int AS count FROM provider_credential_envelopes WHERE tenant_id=$1 AND root_id<>$2",[this.tenant,row.root_id])).count;
  return{...row,remaining};
 }
 async getJob(id:string):Promise<ProviderSecretJob>{return this.transaction(tx=>this.job(tx,id));}
 async advance(id:string,limit=20):Promise<ProviderSecretJob>{
  if(!Number.isInteger(limit)||limit<1||limit>20)throw new ManagedProviderSecretError("Lifecycle batch size must be 1..20",400);
  return this.transaction(async(tx,signal)=>{
   const active=await this.state(tx),job=await this.job(tx,id);if(job.status==="complete")return job;
   if(active!==job.root_id)throw new ManagedProviderSecretError("Lifecycle root changed; operator reconciliation is required");
   const rows=await tx.many<EnvelopeRow>("SELECT * FROM provider_credential_envelopes WHERE tenant_id=$1 AND root_id<>$2 ORDER BY provider_id LIMIT $3 FOR UPDATE",[this.tenant,active,limit]);
   const keys=new Map<string,Buffer>();
   try{
    if(rows.length)keys.set(active!,await this.rootKey(tx,active!,signal));
    for(const row of rows){
     if(!keys.has(row.root_id))keys.set(row.root_id,await this.rootKey(tx,row.root_id,signal));
     const dek=openProviderBytes(row.wrapped_dek,keys.get(row.root_id)!,providerSecretAad(this.tenant,row.provider_id,row.revision,"dek"));
     try{const wrapped=sealProviderBytes(dek,keys.get(active!)!,providerSecretAad(this.tenant,row.provider_id,row.revision,"dek"));await tx.execute("UPDATE provider_credential_envelopes SET root_id=$3,wrapped_dek=$4::jsonb,updated_at=now() WHERE tenant_id=$1 AND provider_id=$2",[this.tenant,row.provider_id,active,JSON.stringify(wrapped)]);}finally{dek.fill(0);}
    }
    await tx.execute("UPDATE provider_secret_jobs SET processed=processed+$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",[this.tenant,id,rows.length]);
    const next=await this.job(tx,id);if(!next.remaining){await tx.execute("UPDATE provider_secret_jobs SET status='complete' WHERE tenant_id=$1 AND id=$2",[this.tenant,id]);next.status="complete";}return next;
   }finally{for(const key of keys.values())key.fill(0);}
  });
 }
 async metadata(){return this.transaction(tx=>tx.one<{roots:Array<{id:string;state:string;created_at:string;revoke_after:string|null}>;envelopes:Array<{provider_id:string;revision:number;root_id:string;updated_at:string}>}>(`SELECT
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'state',state,'created_at',created_at,'revoke_after',revoke_after) ORDER BY created_at,id) FROM provider_secret_roots WHERE tenant_id=$1),'[]'::jsonb) AS roots,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('provider_id',provider_id,'revision',revision,'root_id',root_id,'updated_at',updated_at) ORDER BY provider_id) FROM provider_credential_envelopes WHERE tenant_id=$1),'[]'::jsonb) AS envelopes`,[this.tenant]));}
}
