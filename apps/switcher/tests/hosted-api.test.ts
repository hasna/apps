import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mintApiKey } from "@hasna/contracts/auth";
import { Store } from "../src/store";
import { createHandler } from "../src/service";
import { startServer } from "../src/server";
import { main as serveMain } from "../src/serve";
import { SwitcherClient } from "../src/sdk";

const signingSecret = "switcher-hosted-test-signing-secret-not-for-production";
const roots: string[] = [];
const savedDatabaseUrl = process.env.HASNA_SWITCHER_DATABASE_URL;
const savedSqlitePath = process.env.HASNA_SWITCHER_SQLITE_PATH;

afterEach(async()=>{
  if(savedDatabaseUrl===undefined)delete process.env.HASNA_SWITCHER_DATABASE_URL;else process.env.HASNA_SWITCHER_DATABASE_URL=savedDatabaseUrl;
  if(savedSqlitePath===undefined)delete process.env.HASNA_SWITCHER_SQLITE_PATH;else process.env.HASNA_SWITCHER_SQLITE_PATH=savedSqlitePath;
  for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});
});

async function sqliteStore(){
  const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace","scratch","switcher-tests");
  await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,"hosted-api-"));roots.push(root);
  return Store.open({sqlitePath:join(root,"switcher.db")});
}

function key(scopes:string[]){return mintApiKey({app:"switcher",scopes,signingSecret});}

test("hosted API accepts signed x-api-key and Bearer credentials, enforces scopes, and refuses unknown keys",async()=>{
  const store=await sqliteStore();
  const active=new Set<string>();
  const read=key(["switcher:read"]),write=key(["switcher:read","switcher:write"]),unknown=key(["switcher:read"]);
  for(const credential of [read,write])active.add(credential.kid);
  const handler=createHandler(store,{kind:"signed-api-key",signingSecret,keyStatus:async kid=>active.has(kid)?"active":"unknown"});
  try{
    expect((await handler(new Request("http://switcher.test/health"))).status).toBe(200);
    expect((await handler(new Request("http://switcher.test/ready"))).status).toBe(200);
    expect(await (await handler(new Request("http://switcher.test/ready"))).json()).toEqual({status:"ready",version:expect.any(String),backend:"sqlite"});
    expect((await handler(new Request("http://switcher.test/openapi.json"))).status).toBe(200);
    expect((await handler(new Request("http://switcher.test/v1/providers",{headers:{"x-api-key":read.token}}))).status).toBe(200);
    const denied=await handler(new Request("http://switcher.test/v1/providers",{method:"POST",headers:{"x-api-key":read.token,"content-type":"application/json","idempotency-key":"hosted-read-deny"},body:JSON.stringify({id:"denied",name:"Denied",baseUrl:"https://example.com/v1",protocol:"openai-chat"})}));
    expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:{code:"auth_insufficient_scope"}});
    const created=await handler(new Request("http://switcher.test/v1/providers",{method:"POST",headers:{authorization:`Bearer ${write.token}`,"content-type":"application/json","idempotency-key":"hosted-write-ok"},body:JSON.stringify({id:"hosted",name:"Hosted",baseUrl:"https://example.com/v1",protocol:"openai-chat"})}));
    expect(created.status).toBe(201);
    const provider=await created.json() as any;
    const client=new SwitcherClient({baseUrl:"http://127.0.0.1:9911",apiKey:write.token,fetch:((url:any,init:any)=>handler(new Request(url,init))) as typeof fetch});
    const catalog={models:[{id:"hosted/model",name:"Hosted model"}],refreshedAt:new Date().toISOString(),source:"remote" as const};
    expect(await client.saveCatalog(provider.id,provider.version,catalog,"hosted-catalog-save")).toEqual({models:catalog.models,source:"remote",refreshedAt:expect.any(String)});
    expect((await client.listModels(provider.id)).data.map(model=>model.id)).toEqual(["hosted/model"]);
    await expect(client.saveCatalog(provider.id,provider.version+1,catalog,"hosted-catalog-stale")).rejects.toMatchObject({status:409,code:"provider_changed"});
    await expect(client.saveCatalog(provider.id,provider.version,{...catalog,source:"manual"},"hosted-catalog-source")).rejects.toMatchObject({status:422,code:"catalog_source_mismatch"});
    let contacted=0;const localTarget=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){contacted++;return Response.json({data:[]});}});
    try{
      const localProvider=await client.createProvider({id:"hosted-no-ssrf",name:"Hosted no SSRF",baseUrl:localTarget.url.origin,protocol:"openai-chat"},"hosted-no-ssrf-create");
      await expect(client.refreshModels(localProvider.id,"hosted-no-ssrf-refresh")).rejects.toMatchObject({status:422,code:"local_catalog_refresh_required"});
      expect(contacted).toBe(0);
    }finally{await localTarget.stop(true);}
    const rejected=await handler(new Request("http://switcher.test/v1/providers",{headers:{"x-api-key":unknown.token}}));
    expect(rejected.status).toBe(401);expect(await rejected.json()).toMatchObject({error:{code:"auth_unknown_key"}});
  }finally{await store.close();}
});

test("local static API authentication preserves Bearer and accepts the canonical x-api-key header",async()=>{
  const store=await sqliteStore();const token="switcher-local-static-test-token";const handler=createHandler(store,token);
  try{
    for(const headers of [{authorization:`Bearer ${token}`},{"x-api-key":token}])expect((await handler(new Request("http://switcher.test/v1/providers",{headers}))).status).toBe(200);
    expect((await handler(new Request("http://switcher.test/v1/providers"))).status).toBe(401);
  }finally{await store.close();}
});

test("hosted signed-key mode requires PostgreSQL and migrate refuses every local fallback",async()=>{
  await expect(startServer({signingSecret,sqlitePath:":memory:"})).rejects.toMatchObject({code:"storage_config"});
  delete process.env.HASNA_SWITCHER_DATABASE_URL;delete process.env.HASNA_SWITCHER_SQLITE_PATH;
  await expect(serveMain(["migrate"])).rejects.toMatchObject({code:"storage_config"});
  process.env.HASNA_SWITCHER_SQLITE_PATH=":memory:";
  await expect(serveMain(["migrate"])).rejects.toMatchObject({code:"storage_config"});
});

test("serve help and version exit before database or authentication resolution",async()=>{
  const lines:string[]=[];const original=console.log;console.log=(value?:unknown)=>{lines.push(String(value));};
  delete process.env.HASNA_SWITCHER_DATABASE_URL;delete process.env.HASNA_SWITCHER_SQLITE_PATH;
  try{await serveMain(["--help"]);await serveMain(["--version"]);}
  finally{console.log=original;}
  expect(lines[0]).toContain("switcher-serve [migrate]");
  expect(lines[1]).toMatch(/^0\.2\.3$/);
});
