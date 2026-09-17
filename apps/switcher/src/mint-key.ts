import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ApiKeyStore } from "@hasna/contracts/auth";
import pg from "pg";

const APP="switcher";
const DEFAULT_SECRET_ID="hasna/oss/switcher/api-key";
const MAX_OUTPUT=1024*1024;
type MintResult={ok:true;stored:true;token:string;kid:string;agent?:string;scopes?:string[];expiresAt?:string|null};
type MintOptions={
  env?:NodeJS.ProcessEnv;
  issueKey?:(request:{databaseUrl:string;signingSecret:string;agent:string;scopes:string;ttlDays:string})=>Promise<MintResult>;
  putSecret?:(request:{secretId:string;token:string;kid:string})=>Promise<void>;
  revoke?:(request:{databaseUrl:string;kid:string})=>Promise<void>;
  write?:(line:string)=>void;
};
const required=(env:NodeJS.ProcessEnv,name:string)=>{const value=env[name]?.trim();if(!value)throw new Error(`Missing ${name}.`);return value;};
async function bounded(stream:ReadableStream<Uint8Array>|null){
  if(!stream)return "";const reader=stream.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>MAX_OUTPUT)throw new Error("Mint subprocess output exceeded its bound.");chunks.push(item.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(data);
}
async function issueKey(request:{databaseUrl:string;signingSecret:string;agent:string;scopes:string;ttlDays:string}):Promise<MintResult>{
  const authEntry=fileURLToPath(import.meta.resolve("@hasna/contracts/auth"));
  const cli=join(dirname(authEntry),"..","cli","index.js");await access(cli);
  const child=Bun.spawn([process.execPath,cli,"issue-key","--app",APP,"--agent",request.agent,"--scopes",request.scopes,"--ttl-days",request.ttlDays,"--json"],{
    env:{...process.env,HASNA_SWITCHER_DATABASE_URL:request.databaseUrl,HASNA_SWITCHER_API_SIGNING_KEY:request.signingSecret},stdin:"ignore",stdout:"pipe",stderr:"pipe",
  });
  const [code,stdout]=await Promise.all([child.exited,bounded(child.stdout),bounded(child.stderr).then(()=>undefined)]).then(([exit,text])=>[exit,text] as const);
  let result:unknown;try{result=JSON.parse(stdout);}catch{throw new Error("Credential issuer returned invalid output.");}
  const value=result as Partial<MintResult>;
  if(code!==0||value.ok!==true||value.stored!==true||typeof value.token!=="string"||!value.token||typeof value.kid!=="string"||!value.kid)throw new Error("Credential issuer failed.");
  return value as MintResult;
}
async function putSecret(request:{secretId:string;token:string;kid:string}){
  const client=new SecretsManagerClient({region:process.env.AWS_REGION??"us-east-1"});
  const version=createHash("sha256").update(request.token).digest("hex");
  try{await client.send(new PutSecretValueCommand({SecretId:request.secretId,SecretString:request.token,ClientRequestToken:version}));}
  catch(error){
    try{const observed=await client.send(new GetSecretValueCommand({SecretId:request.secretId,VersionId:version}));if(observed.SecretString===request.token)return;}
    catch{}
    throw error;
  }
}
async function revoke(request:{databaseUrl:string;kid:string}){
  const pool=new pg.Pool({connectionString:request.databaseUrl,max:1,connectionTimeoutMillis:10_000});
  try{
    const store=new ApiKeyStore({
      many:async<T extends Record<string,unknown>>(sql:string,params:readonly unknown[]=[])=>(await pool.query(sql,[...params])).rows as T[],
      get:async<T extends Record<string,unknown>>(sql:string,params:readonly unknown[]=[])=>((await pool.query(sql,[...params])).rows[0] as T|undefined)??null,
      execute:async(sql:string,params:readonly unknown[]=[])=>{await pool.query(sql,[...params]);},
    });
    if(!await store.revoke(request.kid,"credential_delivery_failed",Date.now(),{app:APP}))throw new Error("Issued key could not be revoked after delivery failure.");
  }finally{await pool.end();}
}
export async function mintSwitcherFleetKey(options:MintOptions={}){
  const env=options.env??process.env,write=options.write??(line=>console.log(line));
  const databaseUrl=required(env,"HASNA_SWITCHER_DATABASE_URL"),signingSecret=required(env,"HASNA_SWITCHER_API_SIGNING_KEY");
  const secretId=(env.MINT_SECRET_ID??DEFAULT_SECRET_ID).trim();if(secretId!==DEFAULT_SECRET_ID)throw new Error("Refusing a non-Switcher client-key destination.");
  const agent=(env.MINT_AGENT??"fleet").trim();if(!/^[A-Za-z0-9._-]{1,100}$/.test(agent))throw new Error("Invalid MINT_AGENT.");
  const scopes=(env.MINT_SCOPES??"switcher:read,switcher:write").trim();if(scopes!=="switcher:read,switcher:write")throw new Error("Switcher fleet mint requires the exact read/write scopes.");
  const ttlDays=(env.MINT_TTL_DAYS??"365").trim();if(!/^[1-9]\d{0,3}$/.test(ttlDays))throw new Error("Invalid MINT_TTL_DAYS.");
  const issued=await (options.issueKey??issueKey)({databaseUrl,signingSecret,agent,scopes,ttlDays});
  try{await (options.putSecret??putSecret)({secretId,token:issued.token,kid:issued.kid});}
  catch{
    try{await (options.revoke??revoke)({databaseUrl,kid:issued.kid});}
    catch{throw new Error("Credential delivery failed and issued-key revocation could not be confirmed.");}
    throw new Error("Credential delivery failed; the issued key was revoked.");
  }
  write(JSON.stringify({event:"fleet-key-minted",app:APP,kid:issued.kid,agent:issued.agent??agent,scopes:issued.scopes??scopes.split(","),expiresAt:issued.expiresAt??null,secretId}));
  return {kid:issued.kid,secretId};
}
if(import.meta.main)mintSwitcherFleetKey().catch(error=>{console.error(error instanceof Error?error.message:"Fleet key mint failed.");process.exitCode=1;});
