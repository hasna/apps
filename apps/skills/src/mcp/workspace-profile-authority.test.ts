import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerRemoteCustomerTools } from "./remote-customer-tools.js";
import { saveAuthConfig, getIdentityFilePath, getAuthFilePath } from "../lib/auth-store.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

test("MCP invocation captures named profile through concurrent fresh sign-in and refuses stale authority safely", async () => {
  const home=mkdtempSync(join(tmpdir(), "skills-mcp-context-"));
  const user=randomUUID(),otherUser=randomUUID(),a=randomUUID(),b=randomUUID(),oa=randomUUID(),ob=randomUUID();
  const keyA=`sk_${randomUUID()}`,keyB=`sk_${randomUUID()}`,jwtA=randomUUID(),jwtB=randomUUID(),canary=randomUUID();
  const calls:Array<{path:string;method:string;target:string}>=[];
  const handlers=new Map<string,(input:any)=>Promise<any>>();
  registerRemoteCustomerTools({registerTool(name:string,_schema:unknown,handler:(input:any)=>Promise<any>){handlers.set(name,handler);}} as any);
  let mode="ok",release:()=>void=()=>{},entered:()=>void=()=>{},waitFirst=false;
  let firstEntered=new Promise<void>(resolve=>{entered=resolve;});
  let firstResume=new Promise<void>(resolve=>{release=resolve;});
  const identity=(target:string,method:string)=>({authMethod:method,user:{id:user,membershipId:target==="b"?b:a,email:"owned@example.test",displayName:null,role:"owner"},organization:{id:target==="b"?ob:oa,slug:target,name:target.toUpperCase()}});
  const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
    const path=new URL(req.url).pathname,key=req.headers.get("authorization")?.slice(7),target=key===keyB||key===jwtB?"b":"a";
    calls.push({path,method:req.method,target});
    if(path==="/api/auth/whoami") return mode==="revoked"&&key===keyB?Response.json({error:canary},{status:401}):Response.json(identity(target,key===keyA||key===keyB?"api_key":"jwt"));
    if(path==="/api/auth/verify") {
      if(waitFirst){waitFirst=false;entered();await firstResume;}
      return Response.json({user:{id:mode==="wrong-user"?otherUser:user},token:jwtA});
    }
    if(path==="/api/v1/account/workspaces/switch") {
      if(mode==="removed")return Response.json({code:"WORKSPACE_UNAVAILABLE",error:canary},{status:404});
      const body=await req.json() as {membershipId:string};const selected=body.membershipId===b?"b":"a";
      return Response.json({...identity(selected,"jwt"),token:selected==="b"?jwtB:jwtA});
    }
    if(path==="/api/v1/workspaces/current"&&req.method==="PATCH")return Response.json({organization:identity(target,"jwt").organization});
    if(path.startsWith("/api/auth/keys"))return Response.json({error:canary,token:jwtB,key:keyB},{status:503});
    return new Response("",{status:404});
  }});
  const names=["HOME","HASNA_HOME","HASNA_CONFIG_HOME","HASNA_PROFILE","HASNA_SKILLS_API_URL","SKILLS_API_URL","HASNA_SKILLS_API_KEY_OVERRIDE","HASNA_SKILLS_API_KEY_REF","HASNA_SKILLS_API_KEY","SKILLS_API_KEY"];
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const name of names)delete process.env[name];
  const env={HOME:home,HASNA_HOME:join(home,"fleet"),HASNA_SKILLS_API_URL:server.url.origin,HASNA_PROFILE:"b"};
  Object.assign(process.env,env);
  saveAuthConfig({apiKey:keyB,userId:user,orgId:ob},env,server.url.origin);
  saveAuthConfig({apiKey:keyA,userId:user,orgId:oa},{...env,HASNA_PROFILE:"a"},server.url.origin);
  const before=readFileSync(getAuthFilePath(env),"utf8");
  async function invoke(name:string,input:Record<string,unknown>={}) {
    const result=await handlers.get(name)!({email:"owned@example.test",code:"123456",...input});
    for(const secret of [keyA,keyB,jwtA,jwtB,canary,"123456"])expect(JSON.stringify(result)).not.toContain(secret);
    return result;
  }
  try {
    waitFirst=true;
    const first=invoke("update_workspace_name",{name:"B"});
    await firstEntered;
    process.env.HASNA_PROFILE="a";
    const second=await invoke("update_workspace_name",{name:"A"});
    release();const firstResult=await first;
    expect(JSON.parse(firstResult.content[0].text).organization.id).toBe(ob);
    expect(JSON.parse(second.content[0].text).organization.id).toBe(oa);
    expect(calls.filter(c=>c.method==="PATCH").map(c=>c.target)).toEqual(["a","b"]);
    process.env.HASNA_PROFILE="b";
    for(const refusal of ["wrong-user","removed","revoked"]){mode=refusal;const beforeCalls=calls.length;
      expect((await invoke("update_workspace_name",{name:"Denied"})).isError).toBe(true);
      expect(calls.slice(beforeCalls).some(c=>c.method==="PATCH")).toBe(false);
    }
    mode="ok";
    const identityFile=getIdentityFilePath(env),metadata=readFileSync(identityFile,"utf8");
    writeFileSync(identityFile,JSON.stringify({userId:otherUser}),{mode:0o600});
    const beforeMetadata=calls.length;expect((await invoke("update_workspace_name",{name:"Denied"})).isError).toBe(true);
    expect(calls.slice(beforeMetadata).some(c=>c.path==="/api/auth/verify")).toBe(false);writeFileSync(identityFile,metadata,{mode:0o600});
    for(const name of ["list_api_keys","revoke_api_key","create_api_key"]){
      const result=await invoke(name,{key_id:randomUUID(),name:"owned"});expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).message).not.toContain(canary);
    }
    expect(readFileSync(getAuthFilePath(env),"utf8")).toBe(before);
  } finally {
    release();server.stop(true);for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
    rmSync(home,{recursive:true,force:true});
  }
},30000);
