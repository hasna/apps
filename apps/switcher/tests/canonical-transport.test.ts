// Regression cases identified by the independent credential review. All inputs are synthetic.
import {test,expect} from "bun:test";
import {clientFromEnv,SwitcherError} from "../src/sdk";
import {credentialBindingSchema,vaultEnvironment} from "../src/credentials";
const key="fixture-review+operator=only";
const env={HASNA_SWITCHER_API_KEY:key,HASNA_SWITCHER_API_URL:"https://service.example/prefix"};
test("canonical bridge preserves root probes, API prefix, conditional headers and stable supplied idempotency",async()=>{
 const calls:any[]=[];const client=clientFromEnv(env,{fetch:async(input,init)=>{calls.push({url:String(input),h:new Headers(init?.headers)});return Response.json({ok:true});}});
 await client.health();await client.ready();await client.version();await client.deleteProvider("fixture",3,"owned-idempotency");
 expect(calls.map(c=>c.url)).toEqual(["https://service.example/prefix/health","https://service.example/prefix/ready","https://service.example/prefix/version","https://service.example/prefix/v1/providers/fixture"]);
 expect(calls[3].h.get("if-match")).toBe("3");expect(calls[3].h.get("idempotency-key")).toBe("owned-idempotency");
});
test("canonical bridge redacts reflected 400 500 and redirect bodies without retry or redirect",async()=>{
 for(const status of [400,500,302])for(const representation of [key,encodeURIComponent(key),Buffer.from(key).toString("base64")]){
  let calls=0;const client=clientFromEnv(env,{fetch:async(_input,init)=>{calls++;expect(init?.redirect).toBe("manual");return Response.json({error:{code:"rejected",message:"Rejected "+representation,requestId:"fixture-request"}},{status,headers:{location:"https://other.example"}});}});
  let failure:any;try{await client.listProviders();}catch(e){failure=e;}
  expect(failure).toBeInstanceOf(SwitcherError);expect(failure.status).toBe(status);expect(failure.message).toBe("Rejected [REDACTED]");expect(JSON.stringify(failure)+String(failure)).not.toContain(representation);expect(calls).toBe(1);
 }
});
test("canonical bridge discards fetch exceptions and invalid or oversized payloads",async()=>{
 const cases=[async()=>{throw new Error("Request exposed "+key);},async()=>new Response(key),async()=>new Response(JSON.stringify({data:"x".repeat(16*1024*1024)}))];
 for(const fetcher of cases){const client=clientFromEnv(env,{fetch:fetcher as typeof fetch});let failure:any;try{await client.listProviders();}catch(e){failure=e;}expect(failure).toBeInstanceOf(SwitcherError);expect(JSON.stringify(failure)+String(failure)).not.toContain(key);expect(["connection_failed","invalid_response"]).toContain(failure.code);}
});
test("canonical client never retains old key after Keychain becomes unavailable",async()=>{
 let locked=false,calls=0;const client=clientFromEnv({HASNA_STATION:"fixture-only"},{credentials:{keychain:{platform:"darwin",run:(argv)=>locked?{status:36,stdout:"",stderr:"fixture locked"}:argv.includes("hasna.credentials.switcher.api-key")?{status:0,stdout:key,stderr:""}:{status:44,stdout:"",stderr:""}}},fetch:async()=>{calls++;return Response.json({});}});
 locked=true;await expect(client.listProviders()).rejects.toThrow(/Keychain/);expect(calls).toBe(0);
});
test("shared vault pointer is a specific terminal bootstrap refusal",async()=>{
 const binding=credentialBindingSchema.parse({schema:1,credentialEnv:"SWITCHER_PROVIDER_FIXTURE",origins:["https://provider.example"],source:{kind:"vault",key:"fixture/provider",executable:process.execPath,operator:{kind:"contracts"}}});
 await expect(vaultEnvironment(binding,{HASNA_SECRETS_API_KEY_REF:"fixture/live/operator"})).rejects.toMatchObject({code:"vault_operator_pointer"});
});

import {mkdir,mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {resolveClientTransport,toV1BaseUrl} from "@hasna/contracts/client";
test("shared vault preserves literal canonical URL through child resolution",async()=>{
 const scratch=process.env.SWITCHER_TEST_ROOT ?? join(homedir(),"Workspace/scratch/switcher-tests");
 await mkdir(scratch,{recursive:true});
 const root=await mkdtemp(join(scratch,"vault-url-"));
 try{
  for(const [index,url] of ["https://vault.example/v1","https://vault.example/","https://vault.example/prefix/v1/"].entries())for(const kind of ["env","disk","keychain"]){
   const fixtureRoot=join(root,index+"-"+kind),config=join(fixtureRoot,".hasna/secrets/config");await mkdir(config,{recursive:true});
   const input:any={HOME:fixtureRoot};const options:any={};
   if(kind==="env"){input.HASNA_SECRETS_API_URL=url;input.HASNA_SECRETS_API_KEY=key;}
   if(kind==="disk")await writeFile(join(config,"credentials"),`HASNA_SECRETS_API_KEY=${key}\nHASNA_SECRETS_API_URL=${url}\n`,{mode:0o600});
   if(kind==="keychain")options.keychain={platform:"darwin",enabled:true,run:(argv:readonly string[])=>({status:0,stdout:argv.includes("hasna.credentials.secrets.api-url")?url:key,stderr:""})};
   const binding=credentialBindingSchema.parse({schema:1,credentialEnv:"SWITCHER_PROVIDER_FIXTURE",origins:["https://provider.example"],source:{kind:"vault",key:"fixture/live/provider",executable:process.execPath,operator:{kind:"contracts"}}});
   const child=await vaultEnvironment(binding,input,options);expect(child.HASNA_SECRETS_API_URL).toBe(url);
   expect(resolveClientTransport("secrets",child,{credentials:options}).baseUrl).toBe(toV1BaseUrl(url));
   await expect(vaultEnvironment({...binding,source:{...binding.source,url:"https://wrong.example"}} as any,input,options)).rejects.toMatchObject({code:"vault_operator_authority"});
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test("pinned operator schema rejects empty and surrounding whitespace without implicit normalization",()=>{
 for(const account of [""," ","\t"," named","named "]){const binding={schema:1,credentialEnv:"SWITCHER_PROVIDER_FIXTURE",origins:["https://provider.example"],source:{kind:"vault",key:"fixture/live/provider",url:"https://vault.example",executable:process.execPath,operator:{kind:"keychain",account}}};expect(credentialBindingSchema.safeParse(binding).success).toBe(false);}
});
