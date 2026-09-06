import {test,expect} from "bun:test";
import {discover} from "../src/catalog";
import {parse,providerInputSchema,codingEligible} from "../src/domain";
import {providerFromPreset,providerCredential} from "../src/presets";

test("a provider's catalog can use a different root from its Anthropic inference path",async()=>{
  const requests: {path:string;auth:string|null}[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    requests.push({path:new URL(request.url).pathname,auth:request.headers.get("authorization")});
    return new URL(request.url).pathname==="/models"
      ?Response.json({data:[{id:"deepseek-v4-pro"},{id:"deepseek-v4-flash"}]})
      :new Response("Not found",{status:404});
  }});
  try{
    const provider={...parse(providerInputSchema,{id:"deepseek",name:"DeepSeek",baseUrl:upstream.url.origin+"/anthropic/v1",catalogBaseUrl:upstream.url.origin,protocol:"anthropic-messages",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    const catalog=await discover(provider,{SWITCHER_PROVIDER_TEST:"fixture-key-never-a-provider-key"});
    expect(catalog.source).toBe("remote");
    expect(catalog.models.map(model=>model.id)).toEqual(["deepseek-v4-pro","deepseek-v4-flash"]);
    expect(requests).toEqual([{path:"/models",auth:"Bearer fixture-key-never-a-provider-key"}]);
    expect(provider.manualModels).toEqual([]);
  }finally{await upstream.stop(true);}
});

test("Mistral discovery preserves the full catalog while native selection excludes archived and non-tool models",async()=>{
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return Response.json({data:[
    {id:"chat-current",max_context_length:64000,archived:false,capabilities:{completion_chat:true,function_calling:true,vision:true}},
    {id:"chat-archived",archived:true,capabilities:{completion_chat:true,function_calling:true}},
    {id:"embed",capabilities:{completion_chat:false,function_calling:false}},
    {id:"unknown"},
  ]});}});
  try {
    const provider={...providerFromPreset("mistral",{baseUrl:upstream.url.origin,credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    const catalog=await discover(provider,{SWITCHER_PROVIDER_TEST:"fixture"});
    expect(catalog.models).toHaveLength(4);
    expect(catalog.models[0]).toMatchObject({contextWindow:64000,available:true,inputModalities:["text","image"],supportedParameters:["tools"]});
    expect(catalog.models.filter(codingEligible).map(m=>m.id)).toEqual(["chat-current","unknown"]);
    expect(catalog.models[3].available).toBeUndefined();
    expect(catalog.models[3].supportedParameters).toBeUndefined();
  } finally {await upstream.stop(true);}
});

test("Together uses its documented bare-array catalog and rejects a mismatched parser without inventing tool support",async()=>{
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return Response.json([
    {id:"vendor/chat-model",display_name:"Chat model",type:"chat",context_length:64000},
    {id:"vendor/image-model",type:"image"}, {id:"vendor/embedding-model",type:"embedding"},
  ]);}});
  try {
    const provider={...providerFromPreset("together",{baseUrl:upstream.url.origin,credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    const catalog=await discover(provider,{SWITCHER_PROVIDER_TEST:"fixture"});
    expect(catalog.models).toHaveLength(3);
    expect(catalog.models[0]).toMatchObject({id:"vendor/chat-model",name:"Chat model",contextWindow:64000});
    expect(catalog.models[0].supportedParameters).toBeUndefined();
    expect(catalog.models.filter(codingEligible).map(m=>m.id)).toEqual(["vendor/chat-model"]);
    await expect(discover({...provider,catalogFormat:"openai"},{SWITCHER_PROVIDER_TEST:"fixture"})).rejects.toMatchObject({code:"invalid_catalog"});
    expect(()=>providerFromPreset("together",{harness:"claude"})).toThrow("compatible");
    expect(()=>providerFromPreset("mistral",{harness:"codex"})).toThrow("compatible");
    expect(()=>providerFromPreset("together",{baseUrl:"https://another.example/v1"})).toThrow("origin");
    expect(providerCredential(providerFromPreset("together"),{TOGETHER_API_KEY:"fixture"})).toBe("fixture");
    expect(providerCredential({...providerFromPreset("together"),baseUrl:"https://another.example/v1"},{TOGETHER_API_KEY:"fixture"})).toBeUndefined();
  } finally {await upstream.stop(true);}
});

test("an alternate catalog origin never receives the inference credential implicitly",async()=>{
  let contacted=0;
  const catalog=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){contacted++;return Response.json({data:[]});}});
  try{
    const provider={...parse(providerInputSchema,{id:"split",name:"Split",baseUrl:"https://provider.example/v1",catalogBaseUrl:catalog.url.origin,protocol:"openai-chat",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    await expect(discover(provider,{SWITCHER_PROVIDER_TEST:"fixture-key-never-a-provider-key"})).rejects.toMatchObject({code:"catalog_credential_authority"});
    expect(contacted).toBe(0);
  }finally{await catalog.stop(true);}
});

test("a public or separately authenticated catalog does not require the inference key",async()=>{
  const auth: (string|null)[]=[];
  const catalog=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){auth.push(request.headers.get("authorization"));return Response.json({data:[{id:"vendor/model"}]});}});
  try{
    const input={id:"public",name:"Public catalog",baseUrl:"https://provider.example/v1",catalogBaseUrl:catalog.url.origin,protocol:"openai-chat",credentialEnv:"SWITCHER_PROVIDER_INFERENCE"};
    const make=(extra:object)=>({...parse(providerInputSchema,{...input,...extra}),version:1,updatedAt:"now"});
    expect((await discover(make({catalogAuthStyle:"none"}),{})).models).toHaveLength(1);
    expect((await discover(make({catalogCredentialEnv:"SWITCHER_PROVIDER_CATALOG"}),{SWITCHER_PROVIDER_CATALOG:"catalog-only-fixture-key"})).models).toHaveLength(1);
    expect(auth).toEqual([null,"Bearer catalog-only-fixture-key"]);
  }finally{await catalog.stop(true);}
});

test("Ollama's native tags catalog preserves model IDs and unknown capabilities",async()=>{
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    expect(new URL(request.url).pathname).toBe("/api/tags");
    return Response.json({models:[{name:"qwen:latest",model:"qwen:latest"},{name:"local-model:tag"}]});
  }});
  try{
    const provider={...parse(providerInputSchema,{id:"ollama",name:"Ollama",baseUrl:upstream.url.origin+"/v1",catalogBaseUrl:upstream.url.origin,modelsPath:"api/tags",catalogFormat:"ollama",catalogAuthStyle:"none",protocol:"openai-chat"}),version:1,updatedAt:"now"};
    const result=await discover(provider,{});
    expect(result.models.map(model=>model.id)).toEqual(["qwen:latest","local-model:tag"]);
    expect(result.models[0].supportedParameters).toBeUndefined();
    expect(result.models[0].contextWindow).toBeUndefined();
  }finally{await upstream.stop(true);}
});

test("linked catalog pages retain all models and reject changed authority, loops and incomplete totals",async()=>{
  let mode="pages",calls=0;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    calls++;
    const page=new URL(request.url).searchParams.get("offset");
    if(mode==="foreign")return Response.json({data:[],links:{next:"https://another.example/models?offset=1"}});
    if(mode==="path")return Response.json({data:[],links:{next:"/another-route?offset=1"}});
    if(mode==="loop")return Response.json({data:[{id:"first"}],links:{next:"?offset=1"}});
    if(mode==="incomplete")return Response.json({data:[{id:"first"}],total_count:2,links:{next:null}});
    return Response.json({data:[{id:page?"second":"first"}],total_count:2,links:{next:page?null:"?offset=1&limit=1"}});
  }});
  try {
    const provider={...parse(providerInputSchema,{id:"linked",name:"Linked catalog",baseUrl:upstream.url.origin,protocol:"openai-chat"}),version:1,updatedAt:"now"};
    expect((await discover(provider)).models.map(m=>m.id)).toEqual(["first","second"]);
    expect(calls).toBe(2);
    for(const variant of ["foreign","path"]) {
      mode=variant;calls=0;
      await expect(discover(provider)).rejects.toMatchObject({code:"catalog_credential_authority"});expect(calls).toBe(1);
    }
    mode="loop";calls=0;await expect(discover(provider)).rejects.toMatchObject({code:"invalid_catalog"});expect(calls).toBe(2);
    mode="incomplete";await expect(discover(provider)).rejects.toMatchObject({code:"incomplete_catalog"});
  } finally {await upstream.stop(true);}
});
