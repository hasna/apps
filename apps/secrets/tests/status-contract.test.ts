import {test,expect} from "bun:test";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {getSecretReferenceStatus} from "../src/status.js";

test("API status and actual CLI remain metadata-only",async()=>{
 const home=mkdtempSync(join(tmpdir(),"secrets-status-"));const token=randomUUID();
 const privateValue=randomUUID(),privateKey="private-account/demo-host/provider/live/token",privateLabel="private account token";
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){
  expect(req.headers.get("x-api-key")).toBe(token);
  const path=new URL(req.url).pathname;
  if(path==="/v1/secrets")return Response.json({secrets:[{key:privateKey,value:privateValue,type:"token",label:privateLabel},{key:"example/test/key",type:"api_key"}]});
  if(path==="/v1/users")return Response.json({users:[{id:"fixture",name:"Fixture",type:"agent"}]});
  if(path==="/v1/audit")return Response.json({entries:[]});
  return Response.json({error:"unknown"},{status:404});
 }});
 try {
  const env={HOME:home,PATH:process.env.PATH!,HASNA_SECRETS_API_URL:server.url.origin,HASNA_SECRETS_API_KEY_OVERRIDE:token,HASNA_STATION:randomUUID()};
  const status=await getSecretReferenceStatus(env);
  expect(status).toMatchObject({service:"secrets",schemaVersion:"2.0",counts:{secrets:2,users:1},safety:{includesSecretValues:false,includesSecretKeys:false,includesProviderInventory:false,statusOutputIsMetadataOnly:true}});
  expect(status.counts.byType.token).toBe(1);expect(status.counts.byType.api_key).toBe(1);
  const child=Bun.spawn([process.execPath,"src/index.ts","status","--json"],{cwd:join(import.meta.dir,".."),env,stdout:"pipe",stderr:"pipe"});
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(code,stderr).toBe(0);expect(JSON.parse(stdout).counts.secrets).toBe(2);
  for(const value of [privateValue,privateKey,privateLabel,home,token]) {expect(JSON.stringify(status)).not.toContain(value);expect(stdout).not.toContain(value);}
 }finally{server.stop(true);rmSync(home,{recursive:true,force:true});}
});
