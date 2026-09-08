import { createHash } from "node:crypto";
import { ApiKeyStore, verifyApiKeyToken } from "@hasna/contracts/auth";
import type { Pool } from "pg";
import { INTAKE_PROTOCOL, IntakeError, boundedText, uuid } from "../intake/protocol.js";
import { authQueries, tenantTransaction } from "./intake-postgres.js";
import { migrateIntake } from "./intake-migrations.js";

async function owner(pool: Pool): Promise<void> {
  const row = await pool.query("SELECT pg_get_userbyid(relowner)=current_user AS owned FROM pg_class WHERE oid='events_intake_identity'::regclass");
  if (row.rows[0]?.owned !== true) throw new IntakeError("intake_owner_role_required", 403);
}
export async function initializeIntake(pool: Pool, sinkId: string, authorityId: string): Promise<void> {
  uuid(sinkId); uuid(authorityId);
  await migrateIntake(pool); await owner(pool);
  await pool.query("INSERT INTO events_intake_identity(singleton,sink_id,authority_id,protocol) VALUES(TRUE,$1,$2,$3) ON CONFLICT DO NOTHING", [sinkId,authorityId,INTAKE_PROTOCOL]);
  const row = await pool.query("SELECT sink_id,authority_id FROM events_intake_identity");
  if (row.rows[0]?.sink_id !== sinkId || row.rows[0]?.authority_id !== authorityId) throw new IntakeError("sink_identity_is_immutable", 409);
}
export async function bindProducer(pool: Pool, input: { producer_id: string; tenant_id: string; app: string; corpus_id: string; source_authority_id: string }): Promise<void> {
  await owner(pool); uuid(input.producer_id); uuid(input.corpus_id); uuid(input.source_authority_id); boundedText(input.tenant_id,256);
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(input.app)) throw new IntakeError("invalid_producer_app");
  await tenantTransaction(pool,input.tenant_id,async c => {
    await c.query("INSERT INTO events_producer_bindings(producer_id,tenant_id,app,corpus_id,source_authority_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[input.producer_id,input.tenant_id,input.app,input.corpus_id,input.source_authority_id]);
    const row=(await c.query("SELECT producer_id,tenant_id,app,corpus_id,source_authority_id FROM events_producer_bindings WHERE producer_id=$1",[input.producer_id])).rows[0];
    if (!row || Object.keys(input).some(k=>row[k]!==input[k as keyof typeof input])) throw new IntakeError("producer_identity_is_immutable",409);
  });
}
export async function grantProducerKey(pool: Pool, tenant: string, producer: string, kid: string): Promise<void> {
  await owner(pool); uuid(producer); boundedText(kid,256);
  await tenantTransaction(pool,tenant,async c=>{
    const key=await c.query("SELECT kid FROM api_keys WHERE kid=$1 AND app='events' AND tid=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE",[kid,tenant]);
    if (!key.rows.length) throw new IntakeError("active_registered_tenant_key_required",403);
    await c.query("INSERT INTO events_producer_key_grants(tenant_id,producer_id,kid) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[tenant,producer,kid]);
    const row=(await c.query("SELECT active FROM events_producer_key_grants WHERE tenant_id=$1 AND producer_id=$2 AND kid=$3",[tenant,producer,kid])).rows[0];
    if (!row?.active) throw new IntakeError("key_grant_is_revoked",409);
  });
}
export async function revokeProducerAccess(pool: Pool, tenant: string, producer: string, kid?: string): Promise<void> {
  await owner(pool); uuid(producer); if(kid!==undefined)boundedText(kid,256);
  await tenantTransaction(pool,tenant,async c=>{
    const result=kid===undefined
      ? await c.query("UPDATE events_producer_bindings SET active=FALSE,generation=generation+1 WHERE tenant_id=$1 AND producer_id=$2 AND active RETURNING producer_id",[tenant,producer])
      : await c.query("UPDATE events_producer_key_grants SET active=FALSE,generation=generation+1 WHERE tenant_id=$1 AND producer_id=$2 AND kid=$3 AND active RETURNING producer_id",[tenant,producer,kid]);
    if(!result.rows.length)throw new IntakeError("active_producer_access_not_found",404);
  });
}
/** Register an already-issued signed key via private stdin; never mint or print it. */
export async function registerIntakeKey(pool:Pool, token:string, signingSecret:string):Promise<void>{
  await owner(pool);
  const result=verifyApiKeyToken(token,{expectedApp:"events",signingSecret,requireTenant:true});
  if(!result.ok || !result.tid)throw new IntakeError("invalid_registered_key",403);
  await new ApiKeyStore(authQueries(pool)).insert({kid:result.kid,app:"events",tid:result.tid,scopes:result.claims.scopes,tokenHash:createHash("sha256").update(token).digest("hex"),issuedAt:new Date(result.claims.iat*1000),expiresAt:result.claims.exp===null?null:new Date(result.claims.exp*1000)});
}

export async function runIntakeAdmin(pool:Pool,args:string[],signingSecret?:string):Promise<void>{
  const [operation,...rest]=args;
  const opts:Record<string,string>={};
  for(let i=0;i<rest.length;i+=2){const k=rest[i],v=rest[i+1];if(!k||!v||!/^--[a-z-]+$/.test(k)||Object.hasOwn(opts,k))throw new IntakeError("invalid_admin_arguments");opts[k]=v;}
  const take=(keys:string[])=>{if(Object.keys(opts).length!==keys.length||keys.some(k=>!opts[k]))throw new IntakeError("invalid_admin_arguments");return keys.map(k=>opts[k]!);};
  switch(operation){
    case "init":{const [sink,authority]=take(["--sink-id","--authority-id"]);await initializeIntake(pool,sink!,authority!);break;}
    case "bind":{const [producer,tenant,app,corpus,authority]=take(["--producer-id","--tenant-id","--app","--corpus-id","--source-authority-id"]);await bindProducer(pool,{producer_id:producer!,tenant_id:tenant!,app:app!,corpus_id:corpus!,source_authority_id:authority!});break;}
    case "grant":{const [tenant,producer,kid]=take(["--tenant-id","--producer-id","--kid"]);await grantProducerKey(pool,tenant!,producer!,kid!);break;}
    case "revoke":{const keys=["--tenant-id","--producer-id",...(opts["--kid"]?["--kid"]:[])];const [tenant,producer,kid]=take(keys);await revokeProducerAccess(pool,tenant!,producer!,kid);break;}
    case "register-key":{
      take([]);if(!signingSecret||process.stdin.isTTY)throw new IntakeError("private_key_stdin_required");
      let text="";for await(const chunk of process.stdin){text+=chunk.toString();if(text.length>16384)throw new IntakeError("invalid_registered_key");}
      await registerIntakeKey(pool,text.trim(),signingSecret);break;
    }
    default:throw new IntakeError("unknown_intake_admin_operation");
  }
}
