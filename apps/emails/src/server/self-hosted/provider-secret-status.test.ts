import {expect,test} from "bun:test";
import {mintApiKey,verifyApiKey} from "@hasna/contracts/auth";
import {handleSelfHostedRequest,type SelfHostedServiceDeps} from "./service.js";
import {selfScopedStore,testAuthDeps} from "./auth/test-support.js";
import {DEFAULT_TENANT_ID} from "./migrations.js";
import type {TypedQueryClient} from "../../storage-kit/index.js";
import {fetchProviderSecretStatus,requireProviderSecretOperation} from "../../lib/provider-secret-api.js";
import type {ManagedProviderSecrets} from "./managed-provider-secrets.js";
function fixture(){
 const client={query:async()=>({rows:[],rowCount:0}),many:async()=>[],get:async()=>null,one:async()=>({}),execute:async()=>{}} as TypedQueryClient;
 const store=selfScopedStore(client);const tenants:string[]=[];let probes=0;
 Object.assign(store,{listResource:async(_spec:unknown,options:{offset:number})=>options.offset?[]:[{id:"bound",name:"Bound",type:"ses",active:true,secret_key:"private-fixture-value"},{id:"unconfigured",name:"Missing",type:"resend",active:true}]});
 const secret=crypto.randomUUID();
 const deps={client,store,verifier:verifyApiKey({app:"emails",signingSecret:secret,keyStatus:async()=>"active"}),version:"fixture",migrations:[],...testAuthDeps(client,secret),env:{},resolveSender:(tenant:string,id:string)=>{tenants.push(tenant);return id==="bound"?{provider:"ses",credentialSource:"deployment_role",send:async()=>{throw Error("must not send");},probe:async()=>{probes++;return{};}}:null;}} as SelfHostedServiceDeps;
 const token=(scopes=["emails:*"])=>mintApiKey({app:"emails",scopes,signingSecret:secret}).token;
 const request=(scopes?:string[])=>handleSelfHostedRequest(deps,new Request("https://fixture/v1/providers/secrets/status",{headers:{Authorization:`Bearer ${token(scopes)}`}}));
 return{request,deps,token,tenants,probes:()=>probes};
}
test("operator status reports only tenant binding metadata and cannot claim managed key operations",async()=>{
 const f=fixture();const response=(await f.request())!;expect(response.status).toBe(200);const body=await response.json();
 expect(body).toMatchObject({source:"server_references",complete:true,checked:false,activeKeyId:null,managed_envelopes:0,capabilities:{status:true,rewrap:false,rotate_root:false,revoke_root:false}});
 expect(body.providers[0]).toMatchObject({provider_id:"bound",configured:true,credential_source:"deployment_role"});expect(body.providers[1].configured).toBe(false);
 expect(JSON.stringify(body)).not.toContain("private-fixture-value");expect(f.tenants).toEqual([DEFAULT_TENANT_ID,DEFAULT_TENANT_ID]);expect(f.probes()).toBe(0);
 for(const operation of ["rewrap","rotate-root","revoke-root"] as const)expect(()=>requireProviderSecretOperation(body,operation)).toThrow("server-managed tenant");
});
test("ordinary tenant readers and writers cannot inspect server credential metadata",async()=>{
 const f=fixture();for(const scope of ["emails:read","emails:write"])expect((await f.request([scope]))!.status).toBe(403);expect(f.tenants).toEqual([]);
});
test("managed status uses metadata without invoking the credential decrypting resolver",async()=>{
 const f=fixture();let resolutions=0;
 f.deps.resolveExternalSender=f.deps.resolveSender;
 f.deps.resolveSender=async()=>{resolutions++;throw Error("must not unwrap credentials for status");};
 f.deps.managedProviderSecrets=()=>({metadata:async()=>({roots:[{id:"root",state:"active",created_at:"fixture"}],envelopes:[{provider_id:"bound",root_id:"root",revision:1,updated_at:"fixture"}]})} as unknown as ManagedProviderSecrets);
 const response=(await f.request())!;expect(response.status).toBe(200);const body=await response.json();
 expect(body).toMatchObject({checked:false,managed_envelopes:1,activeKeyId:"root"});
 expect(body.providers[0]).toMatchObject({credential_source:"managed_envelope",externally_managed:false});
 expect(resolutions).toBe(0);expect(f.probes()).toBe(0);
});
test("client validates actual API status, uses credentials and rejects older APIs",async()=>{
 const f=fixture();const status=await fetchProviderSecretStatus({baseUrl:"https://fixture/v1",credentials:[f.token()],fetchImpl:async(input,init)=>(await handleSelfHostedRequest(f.deps,new Request(input,init)))!});expect(status.complete).toBe(true);
 await expect(fetchProviderSecretStatus({baseUrl:"https://fixture/v1",credentials:[f.token()],fetchImpl:async()=>new Response(null,{status:404})})).rejects.toThrow("needs an update");
});
test("real CLI status reads API without creating a local mail database",async()=>{
 const {mkdtempSync,rmSync,existsSync}=await import("node:fs");const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 const home=mkdtempSync(join(tmpdir(),"emails-secret-status-")),f=fixture();
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>(await handleSelfHostedRequest(f.deps,req))??new Response(null,{status:404})});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith("EMAILS_")&&!key.startsWith("HASNA_EMAILS_")));
 Object.assign(env,{HOME:home,HASNA_EMAILS_HOME:home,EMAILS_HOME:home,HASNA_EMAILS_API_URL:server.url.origin,HASNA_EMAILS_API_KEY:f.token(),EMAILS_CLIENT_ENV_LOADED:"1",NO_COLOR:"1"});
 const child=Bun.spawn({cmd:[process.execPath,"--no-env-file","src/cli/index.tsx","--json","provider","secrets","status"],env,stdout:"pipe",stderr:"pipe"});
 try{const [code,out,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(code).toBe(0);expect(error).toBe("");expect(JSON.parse(out).providers).toHaveLength(2);expect(existsSync(join(home,"emails.db"))).toBe(false);}finally{child.kill();server.stop(true);rmSync(home,{recursive:true,force:true});}
},20000);
