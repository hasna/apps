import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import { createHandler } from "../src/service";
import { SwitcherClient, clientFromEnv } from "../src/sdk";
import { discover } from "../src/catalog";
import { parse, providerInputSchema } from "../src/domain";
const token = "switcher-test-token-never-valid-for-a-provider";
for (const engine of ["sqlite","postgresql"] as const) {
  describe.skipIf(engine==="postgresql"&&!process.env.SWITCHER_TEST_DATABASE_URL)(engine,()=>{
    let store: Store; let client: SwitcherClient; let handle: ReturnType<typeof createHandler>;
    let root: string; let admin: SQL|undefined; let schema: string;
    let config: Parameters<typeof Store.open>[0];
    beforeAll(async()=>{
      const base = process.env.SWITCHER_TEST_ROOT ?? join(homedir(),"Workspace","scratch","switcher-tests");
      await mkdir(base,{recursive:true}); root = await mkdtemp(join(base,`${engine}-`));
      config = {sqlitePath:join(root,"store.db")};
      if(engine==="postgresql") {
        admin = new SQL(process.env.SWITCHER_TEST_DATABASE_URL!); schema = `switcher_test_${crypto.randomUUID().replaceAll("-","")}`;
        await admin.unsafe(`CREATE SCHEMA ${schema}`);
        const url = new URL(process.env.SWITCHER_TEST_DATABASE_URL!);url.searchParams.set("options",`-c search_path=${schema}`);
        config={databaseUrl:url.href};
      }
      store=await Store.open(config); handle=createHandler(store,token);
      client = new SwitcherClient({baseUrl:"http://127.0.0.1:9911",apiKey:token,fetch:((url:any,init:any)=>handle(new Request(url,init))) as typeof fetch});
    });
    afterAll(async()=>{await store?.close();if(admin){await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);await admin.close();}await rm(root,{recursive:true,force:true});});
    test("auth, input validation, durable idempotency, conflicts and restart persistence",async()=>{
      expect((await handle(new Request("http://localhost/health"))).status).toBe(200);
      expect((await handle(new Request("http://localhost/v1/providers"))).status).toBe(401);
      const input={id:"test-provider",name:"Test provider",baseUrl:"https://example.com/api/v1",protocol:"openai-responses" as const,catalogBaseUrl:"https://example.com/catalog/v1",catalogFormat:"openai" as const,catalogAuthStyle:"none" as const,manualModels:[{id:"test-model",name:"Test model",outputModalities:["text"],supportedParameters:["tools"]}]};
      const p=await client.createProvider(input,"stable-request-001");
      expect(p.version).toBe(1);
      expect(await client.createProvider(input,"stable-request-001")).toEqual(p);
      await expect(client.createProvider({...input,name:"Different"},"stable-request-001")).rejects.toMatchObject({status:409,code:"idempotency_conflict"});
      await expect(client.createProvider(input)).rejects.toMatchObject({status:409});
      await expect(client.createProvider({...input,id:"invalid",apiKey:"not-accepted"} as any)).rejects.toMatchObject({status:400});
      await expect(client.createProfile({id:"bad-protocol",name:"Bad",providerId:p.id,harness:"claude",model:"test-model"})).rejects.toMatchObject({code:"protocol_mismatch"});
      expect((await client.listProfiles()).total).toBe(0);
      const profile=await client.createProfile({id:"profile",name:"Native test",providerId:p.id,harness:"codex",model:"test-model"});
      await expect(client.launchPlan(profile.id)).rejects.toMatchObject({code:"catalog_missing"});
      await client.refreshModels(p.id);
      let plan=await client.launchPlan(profile.id);
      expect(plan.catalog.models.map(m=>m.id)).toEqual(["test-model"]);
      expect((await client.listModels(p.id,{search:"Test model"})).total).toBe(1);
      const {version:profileVersion,updatedAt:_profileUpdated,...profileInput}=profile;
      await client.updateProfile({...profileInput,name:"Changed before launch"},profileVersion);
      await expect(client.createRun({profileId:profile.id,harness:profile.harness,model:profile.model,planToken:plan.planToken})).rejects.toMatchObject({code:"plan_changed"});
      plan=await client.launchPlan(profile.id);
      await client.refreshModels(p.id); // Identical catalog refresh must not invalidate concurrent launches.
      const run=await client.createRun({profileId:profile.id,harness:profile.harness,model:profile.model,planToken:plan.planToken});
      const finished=await client.finishRun(run.id,run.version,{status:"exited",exitCode:0});
      expect(finished.endedAt).toBeDefined();
      await expect(client.finishRun(run.id,finished.version,{status:"failed",exitCode:1})).rejects.toMatchObject({code:"run_finished"});
      await expect(client.deleteProvider(p.id,p.version)).rejects.toMatchObject({status:409});
      await expect(client.updateProvider(input,99)).rejects.toMatchObject({code:"version_conflict"});
      const updated=await client.updateProvider({...input,name:"Updated"},p.version);expect(updated.version).toBe(2);
      await expect(client.launchPlan(profile.id)).rejects.toMatchObject({code:"catalog_missing"});
      await store.close(); store=await Store.open(config); handle=createHandler(store,token);
      expect((await client.getProvider(p.id)).name).toBe("Updated");
      expect((await client.getProvider(p.id)).catalogBaseUrl).toBe(input.catalogBaseUrl);
      expect((await client.getProvider(p.id)).catalogAuthStyle).toBe("none");
      expect(await client.createProvider(input,"stable-request-001")).toEqual(p);
      expect((await client.getRun(run.id)).exitCode).toBe(0);
    });
    test("transaction rolls back partial writes and concurrent idempotency is stable",async()=>{
      await expect(store.mutate("rollback-transaction","hash-1",async db=>{
        await store.put("providers",{id:"must-rollback"},undefined,db);throw new Error("injected failure");
      })).rejects.toThrow();
      await expect(store.get("providers","must-rollback")).rejects.toMatchObject({status:404});
      const input={id:"concurrent",name:"Concurrent",baseUrl:"https://example.com",protocol:"openai-chat" as const};
      const results=await Promise.all([client.createProvider(input,"concurrent-request"),client.createProvider(input,"concurrent-request")]);
      expect(results[0]).toEqual(results[1]);
    });
    test("generation methods survive API storage and prevent unsupported launch plans",async()=>{
      const provider=await client.createProvider({id:"generation-methods",name:"Generation methods",baseUrl:"https://example.com/v1beta",protocol:"gemini-generate-content",authStyle:"x-api-key",manualModels:[
        {id:"chat",name:"Chat",supportedGenerationMethods:["generateContent","countTokens"]},
        {id:"embedding",name:"Embedding",supportedGenerationMethods:["embedContent"]},
      ]});
      await client.refreshModels(provider.id);
      const list=await client.listModels(provider.id);
      expect(list.data).toMatchObject([{id:"chat",supportedGenerationMethods:["generateContent","countTokens"],codingEligible:true},{id:"embedding",supportedGenerationMethods:["embedContent"],codingEligible:false}]);
      const supported=await client.createProfile({id:"methods-chat",name:"Chat",providerId:provider.id,harness:"gemini",model:"chat"});
      const rejected=await client.createProfile({id:"methods-embedding",name:"Embedding",providerId:provider.id,harness:"gemini",model:"embedding"});
      expect((await client.launchPlan(supported.id)).catalog.models).toHaveLength(2);
      await expect(client.launchPlan(rejected.id)).rejects.toMatchObject({code:"model_ineligible"});
    });
  });
}
test("clients reject missing credentials, cleartext remote URLs and redirects",async()=>{
  expect(()=>clientFromEnv({})).toThrow("no local database fallback");
  expect(()=>new SwitcherClient({baseUrl:"http://example.com",apiKey:token})).toThrow();
  expect(()=>new SwitcherClient({baseUrl:"https://user:password@example.com",apiKey:token})).toThrow();
  let redirected=0;
  const target=Bun.serve({port:0,hostname:"127.0.0.1",fetch(){redirected++;return Response.json({});}});
  const redirect=Bun.serve({port:0,hostname:"127.0.0.1",fetch(){return Response.redirect(target.url,302);}});
  try {
    const client=new SwitcherClient({baseUrl:redirect.url.href,apiKey:token});
    await expect(client.listProviders()).rejects.toThrow(); expect(redirected).toBe(0);
    const provider={...parse(providerInputSchema,{id:"remote",name:"Remote",baseUrl:redirect.url.href,protocol:"openai-chat",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    await expect(discover(provider,{SWITCHER_PROVIDER_TEST:"fake-provider-key"})).rejects.toMatchObject({code:"provider_rejected"});expect(redirected).toBe(0);
  } finally {await target.stop();await redirect.stop();}
});
test("catalog pagination preserves IDs and unknown metadata",async()=>{
  const seen:string[]=[];
  const server=Bun.serve({port:0,hostname:"127.0.0.1",fetch(req){
    const url=new URL(req.url);seen.push(url.pathname);
    return Response.json(url.searchParams.has("after_id")?{data:[{id:"vendor/text",name:"Text",context_length:200000}],has_more:false}:{data:[{id:"vendor/embed",architecture:{output_modalities:["embeddings"]}}],has_more:true,last_id:"vendor/embed"});
  }});
  try {
    const p={...parse(providerInputSchema,{id:"paged",name:"Paged",baseUrl:server.url.href+"prefix/v1",protocol:"openai-chat"}),version:1,updatedAt:"now"};
    const catalog=await discover(p);expect(catalog.models.map(m=>m.id)).toEqual(["vendor/embed","vendor/text"]);expect(catalog.models[1].supportedParameters).toBeUndefined();expect(seen).toEqual(["/prefix/v1/models","/prefix/v1/models"]);
  }finally {await server.stop();}
});
test("OpenAPI model lists declare eligibility and catalog provenance",async()=>{
  const spec=await Bun.file(new URL('../openapi.json',import.meta.url)).json();
  const response=spec.paths['/v1/providers/{id}/models'].get.responses['200'].content['application/json'].schema;
  expect(response.$ref).toBe('#/components/schemas/ModelPage');
  expect(spec.components.schemas.ModelPage.required).toContain('refreshedAt');
  expect(spec.components.schemas.ModelPage.properties.data.items.properties.codingEligible.type).toBe('boolean');
});

test("exhausted catalog refresh preserves the last committed snapshot", async()=>{
  let failed = false;
  const upstream = Bun.serve({hostname:"127.0.0.1", port:0, fetch(){
    return failed
      ? new Response("temporarily unavailable", {status:503})
      : Response.json({data:[{id:"stable-model",name:"Stable model"}]});
  }});
  const base = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace", "scratch", "switcher-tests");
  await mkdir(base,{recursive:true});
  const root = await mkdtemp(join(base, "f04-service-"));
  let store: Store | undefined;
  try {
    store = await Store.open({sqlitePath:join(root,"store.db")});
    const handle = createHandler(store, token);
    const client = new SwitcherClient({baseUrl:"http://127.0.0.1:9911",apiKey:token,fetch:((url:any,init:any)=>handle(new Request(url,init))) as typeof fetch});
    const provider = await client.createProvider({id:"snapshot-provider",name:"Snapshot provider",baseUrl:upstream.url.origin,protocol:"openai-chat"});
    await client.refreshModels(provider.id);
    const before = await client.listModels(provider.id);
    failed = true;
    await expect(client.refreshModels(provider.id)).rejects.toMatchObject({code:"provider_rejected"});
    expect(await client.listModels(provider.id)).toEqual(before);
  } finally {
    await store?.close();
    await upstream.stop(true);
    await rm(root,{recursive:true,force:true});
  }
});
