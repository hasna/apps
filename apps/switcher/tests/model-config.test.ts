import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import { createHandler } from "../src/service";
import { SwitcherClient } from "../src/sdk";
import { providerFromPreset } from "../src/presets";
const owned: {dir:string;store:Store}[]=[];
afterEach(async()=>{for(const fixture of owned.splice(0)){await fixture.store.close();await rm(fixture.dir,{recursive:true,force:true});}});
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"switcher-model-config-"));const store=await Store.open({sqlitePath:join(dir,"store.db")});owned.push({dir,store});
  const token="model-config-fixture-operator-token";const handler=createHandler(store,token);
  const client=new SwitcherClient({baseUrl:"http://127.0.0.1:9998",apiKey:token,fetch:((input:any,init:any)=>handler(new Request(input,init))) as typeof fetch});
  return client;
}
test("SDK configures arbitrary manual models, edits metadata, selects and removes them",async()=>{
  const client=await fixture();
  await client.createProvider({id:"private-deployment",name:"Deployment",baseUrl:"http://127.0.0.1:9997/v1",protocol:"openai-responses",catalogFormat:"none",credentialEnv:"SWITCHER_PROVIDER_DEPLOYMENT"});
  const created=await client.addModel("private-deployment",{id:"team/model:latest",name:"Team model",contextWindow:16000,supportedParameters:["tools"]});
  expect(created.manualModels).toEqual([{id:"team/model:latest",name:"Team model",contextWindow:16000,supportedParameters:["tools"]}]);
  expect(created.credentialEnv).toBe("SWITCHER_PROVIDER_DEPLOYMENT");
  await client.refreshModels(created.id);
  await client.createProfile({id:"selected",name:"Selected",providerId:created.id,harness:"codex",model:"team/model:latest"});
  expect((await client.launchPlan("selected")).profile.model).toBe("team/model:latest");
  await expect(client.addModel(created.id,{id:"team/model:latest",name:"Duplicate"})).rejects.toMatchObject({code:"model_exists"});
  await client.updateModel(created.id,{id:"team/model:latest",name:"Updated",expiresOn:"2000-01-01"});
  await client.refreshModels(created.id);
  await expect(client.launchPlan("selected")).rejects.toMatchObject({code:"model_expired"});
  await client.removeModel(created.id,"team/model:latest");
  expect((await client.getProvider(created.id)).manualModels).toEqual([]);
  await expect(client.refreshModels(created.id)).rejects.toMatchObject({code:"catalog_unsupported"});
});
test("SDK model edits preserve discovery, reject secret fields and keep concurrent writes",async()=>{
  const client=await fixture();const input={id:"custom",name:"Custom",baseUrl:"https://provider.example/v1",protocol:"openai-chat" as const};
  const saved=await client.createProvider(input);
  await expect(client.addModel(saved.id,{id:"bad",name:"Bad",apiKey:"fixture-do-not-store"} as any)).rejects.toThrow();
  await expect(client.addModel(saved.id,{id:" \n",name:"Blank"})).rejects.toThrow();
  expect((await client.getProvider(saved.id)).version).toBe(saved.version);
  await client.addModel(saved.id,{id:"new-release",name:"New release"});
  const updated=await client.getProvider(saved.id);
  expect(updated.manualModels).toEqual([]);expect(updated.additionalModels).toEqual([{id:"new-release",name:"New release"}]);
  const get=client.getProvider.bind(client);client.getProvider=async()=>saved;
  await expect(client.addModel(saved.id,{id:"stale",name:"Stale"})).rejects.toMatchObject({status:409});
  client.getProvider=get;expect((await client.getProvider(saved.id)).additionalModels).toEqual(updated.additionalModels);
  await expect(client.removeModel(saved.id,"remote-only")).rejects.toMatchObject({code:"model_not_configured"});
});
test("DeepSeek preset uses officially launched Flash and supports Codex Responses",()=>{
  const provider=providerFromPreset("deepseek",{harness:"codex"});
  expect(provider.protocol).toBe("openai-responses");expect(provider.baseUrl).toBe("https://api.deepseek.com");
  expect(provider.additionalModels).toEqual([expect.objectContaining({id:"deepseek-flash",name:"DeepSeek V4.1 Flash",inputModalities:["text","image"],supportedParameters:["tools"]})]);
  expect(provider.additionalModels?.[0].expiresOn).toBeUndefined();
  expect(providerFromPreset("deepseek",{baseUrl:"https://proxy.example/v1",credentialEnv:"SWITCHER_PROVIDER_PROXY"}).additionalModels).toEqual([]);
});

test("model overlays preserve remote discovery and removal reveals upstream metadata",async()=>{
  const client=await fixture();let failing=false;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>failing ? new Response("unavailable",{status:503}) : Response.json({data:[{id:"remote",name:"Upstream"}]})});
  try{
    await client.createProvider({id:"overlay",name:"Overlay",baseUrl:upstream.url.origin,protocol:"openai-chat"});
    await client.addModel("overlay",{id:"remote",name:"Custom metadata",contextWindow:32000});
    await client.addModel("overlay",{id:"new-release",name:"New release"});
    expect((await client.refreshModels("overlay")).models).toEqual(expect.arrayContaining([{id:"remote",name:"Custom metadata",contextWindow:32000},{id:"new-release",name:"New release"}]));
    await client.removeModel("overlay","remote");
    expect((await client.refreshModels("overlay")).models.find(model=>model.id==="remote")?.name).toBe("Upstream");
    failing=true;
    await expect(client.refreshModels("overlay")).rejects.toMatchObject({code:"provider_rejected"});
    expect((await client.listModels("overlay")).data).toHaveLength(2);
  }finally{await upstream.stop(true);}
});
