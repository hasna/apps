import {test,expect} from "bun:test";
import {discover} from "../src/catalog";
import {parse,providerInputSchema,codingEligible} from "../src/domain";
import {getProviderPreset,providerFromPreset,providerCredential} from "../src/presets";
import {prepareHarnessLaunch} from "../src/harnesses";
import {mkdir,mkdtemp,readFile,rm} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

test("material compatible provider presets expose only documented routes and credential aliases",()=>{
  const expected={
    fireworks:{protocols:["openai-chat","openai-responses","anthropic-messages"],alias:"FIREWORKS_API_KEY",base:"https://api.fireworks.ai/inference/v1"},
    moonshot:{protocols:["openai-chat"],alias:"MOONSHOT_API_KEY",base:"https://api.moonshot.ai/v1"},
    dashscope:{protocols:["openai-chat"],alias:"DASHSCOPE_API_KEY",base:"https://dashscope-us.aliyuncs.com/compatible-mode/v1"},
    zai:{protocols:["openai-chat"],alias:"ZAI_API_KEY",base:"https://api.z.ai/api/paas/v4"},
    minimax:{protocols:["openai-chat","anthropic-messages"],alias:"MINIMAX_API_KEY",base:"https://api.minimax.cn/v1"},
    siliconflow:{protocols:["openai-chat"],alias:"SILICONFLOW_API_KEY",base:"https://api.siliconflow.cn/v1"},
  } as const;
  for(const [id,contract] of Object.entries(expected)){
    const preset=getProviderPreset(id);
    expect(preset.protocols.map(route=>route.protocol)).toEqual(contract.protocols);
    expect(preset.protocols[0].baseUrl).toBe(contract.base);
    expect(preset.credentialAliases).toEqual([contract.alias]);
    expect(preset.credentialEnv).toBe(`SWITCHER_PROVIDER_${id.toUpperCase()}`);
    expect(preset.verification).toBe("documented");
    const provider = id === "fireworks" ? providerFromPreset(id,{catalogAccountId:"fixture-account"}) : providerFromPreset(id);
    expect(providerCredential(provider,{[contract.alias]:"fixture"})).toBe("fixture");
  }
  expect(()=>providerFromPreset("fireworks")).toThrow("catalog-account-id");
  expect(providerFromPreset("fireworks",{harness:"claude",catalogAccountId:"fixture-account"})).toMatchObject({baseUrl:"https://api.fireworks.ai/inference/v1",catalogBaseUrl:"https://api.fireworks.ai/v1/accounts/fixture-account",catalogFormat:"fireworks"});
  expect(providerFromPreset("minimax",{harness:"claude"})).toMatchObject({baseUrl:"https://api.minimax.cn/anthropic/v1",authStyle:"x-api-key",catalogBaseUrl:"https://api.minimax.cn/anthropic/v1",catalogAuthStyle:"x-api-key"});
  expect(providerFromPreset("dashscope")).toMatchObject({catalogFormat:"none"});
  expect(providerFromPreset("zai")).toMatchObject({catalogFormat:"none"});
  expect(()=>providerFromPreset("dashscope",{harness:"claude"})).toThrow("compatible");
});

test("provider routes resolve to complete documented inference paths",()=>{
  const paths={
    fireworks:["/inference/v1/chat/completions","/inference/v1/responses","/inference/v1/messages"],
    moonshot:["/v1/chat/completions"], dashscope:["/compatible-mode/v1/chat/completions"],
    zai:["/api/paas/v4/chat/completions"], minimax:["/v1/chat/completions","/anthropic/v1/messages"], siliconflow:["/v1/chat/completions"],
  } as const;
  for(const [id,expected] of Object.entries(paths)) {
    const preset=getProviderPreset(id);
    const actual=preset.protocols.map(route=>new URL(`${route.baseUrl}/${route.protocol === "anthropic-messages" ? "messages" : route.protocol === "openai-responses" ? "responses" : "chat/completions"}`).pathname);
    expect(actual).toEqual(expected);
  }
});

test("MiniMax Anthropic catalog route uses its documented separate x-api-key model endpoint",async()=>{
  const auth: (string|null)[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    const url=new URL(request.url);auth.push(request.headers.get("x-api-key"));
    expect(url.pathname).toBe("/anthropic/v1/models");
    return Response.json({data:[{id:"MiniMax-M2.7",display_name:"MiniMax M2.7"}],has_more:false});
  }});
  try{
    const provider={...providerFromPreset("minimax",{harness:"claude",baseUrl:upstream.url.origin+"/anthropic/v1",catalogBaseUrl:upstream.url.origin+"/anthropic/v1",catalogCredentialEnv:"SWITCHER_PROVIDER_MINIMAX_CATALOG",catalogAuthStyle:"x-api-key",credentialEnv:"SWITCHER_PROVIDER_MINIMAX"}),version:1,updatedAt:"now"};
    const catalog=await discover(provider,{SWITCHER_PROVIDER_MINIMAX:"inference-fixture",SWITCHER_PROVIDER_MINIMAX_CATALOG:"catalog-fixture"});
    expect(catalog.models.map(model=>model.id)).toEqual(["MiniMax-M2.7"]);
    expect(auth).toEqual(["catalog-fixture"]);
  }finally{await upstream.stop(true);}
});

test("Fireworks discovery uses the account-scoped catalog, provider shape, and pageToken pagination",async()=>{
  const requests:{path:string;pageToken:string|null;auth:string|null}[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    const url=new URL(request.url); requests.push({path:url.pathname,pageToken:url.searchParams.get("pageToken"),auth:request.headers.get("authorization")});
    if(!url.searchParams.has("pageToken")) return Response.json({models:[{name:"accounts/acct/models/first",displayName:"First",description:"first",contextLength:64000,supportsImageInput:true,supportsTools:true}],nextPageToken:"next",totalSize:2});
    return Response.json({models:[{name:"accounts/acct/models/second",displayName:"Second",contextLength:32000}],nextPageToken:""});
  }});
  try {
    const provider={...providerFromPreset("fireworks",{catalogAccountId:"acct",baseUrl:upstream.url.origin+"/inference/v1",catalogBaseUrl:upstream.url.origin+"/v1/accounts/acct",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    const result=await discover(provider,{SWITCHER_PROVIDER_TEST:"fixture"});
    expect(result.models).toMatchObject([{id:"accounts/acct/models/first",name:"First",contextWindow:64000,inputModalities:["text","image"],supportedParameters:["tools"]},{id:"accounts/acct/models/second",name:"Second",contextWindow:32000}]);
    expect(requests).toEqual([{path:"/v1/accounts/acct/models",pageToken:null,auth:"Bearer fixture"},{path:"/v1/accounts/acct/models",pageToken:"next",auth:"Bearer fixture"}]);
    const scratch=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(scratch,{recursive:true});
    const dir=await mkdtemp(join(scratch,"fireworks-native-"));
    try {
      for(const harness of ["codex","opencode2"] as const) {
        const prepared=await prepareHarnessLaunch({harness,baseUrl:provider.baseUrl,protocol:"openai-responses",model:result.models[0].id,models:result.models,credential:"fixture",authStyle:"bearer",stateDir:join(dir,harness),cwd:dir,args:[],version:harness==="codex"?"codex-cli 0.153.4":"opencode2 beta-19157"});
        const config=JSON.parse(await readFile(prepared.configPaths[0],"utf8"));
        const input=harness==="codex"?config.models[0].input_modalities:Object.values(config.providers).map((p:any)=>p.models[result.models[0].id].capabilities.input)[0];
        expect(input).toEqual(["text","image"]);
        await prepared.cleanup?.();
      }
    } finally {await rm(dir,{recursive:true,force:true});}
  } finally {await upstream.stop(true);}
});

test("Fireworks preserves earlier page counts and rejects changing or incomplete snapshots",async()=>{
  let finalTotal:number|undefined;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    return Response.json(new URL(request.url).searchParams.has("pageToken")
      ?{models:[{name:"accounts/acct/models/second"}],totalSize:finalTotal,nextPageToken:""}
      :{models:[{name:"accounts/acct/models/first"}],totalSize:3,nextPageToken:"next"});
  }});
  try {
    const provider={...providerFromPreset("fireworks",{catalogAccountId:"acct",baseUrl:upstream.url.origin+"/inference/v1",catalogBaseUrl:upstream.url.origin+"/v1/accounts/acct",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    for(finalTotal of [undefined,2])await expect(discover(provider,{SWITCHER_PROVIDER_TEST:"fixture"})).rejects.toMatchObject({code:"incomplete_catalog"});
  } finally {await upstream.stop(true);}
});

test("DashScope discovery parses its output.models response and page_no pagination only when explicitly configured",async()=>{
  const requests:string[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    const url=new URL(request.url); requests.push(url.pathname+url.search);
    const page=Number(url.searchParams.get("page_no") ?? "1");
    return Response.json({success:true,output:{total:2,page_no:page,page_size:1,models:page===1?[{model:"qwen3-max",name:"Qwen3-Max",description:"reasoning",features:["function-calling"],inference_metadata:{request_modality:["Text"],response_modality:["Text"]},model_info:{context_window:131072,max_output_tokens:16384}}]:[{model:"qwen-image-max",name:"Qwen-Image-Max",inference_metadata:{request_modality:["Text"],response_modality:["Image"]}}]}});
  }});
  try {
    const provider={...providerFromPreset("dashscope",{catalogBaseUrl:upstream.url.origin+"/api/v1",catalogFormat:"dashscope",catalogCredentialEnv:"SWITCHER_PROVIDER_TEST_CATALOG",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    const result=await discover(provider,{SWITCHER_PROVIDER_TEST:"inference-fixture",SWITCHER_PROVIDER_TEST_CATALOG:"catalog-fixture"});
    expect(result.models).toMatchObject([{id:"qwen3-max",name:"Qwen3-Max",contextWindow:131072,maxOutputTokens:16384,inputModalities:["text"],outputModalities:["text"],supportedParameters:["tools"]},{id:"qwen-image-max",name:"Qwen-Image-Max",inputModalities:["text"],outputModalities:["image"]}]);
    expect(requests).toEqual(["/api/v1/models","/api/v1/models?page_no=2&page_size=1"]);
  } finally {await upstream.stop(true);}
});

test("catalog modality metadata must be an array and omitted capability fields stay unknown",async()=>{
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return Response.json({data:[{id:"bad",inference_metadata:{request_modality:"Text"}}]});}});
  try {
    const provider={...providerFromPreset("moonshot",{baseUrl:upstream.url.origin+"/v1",catalogBaseUrl:upstream.url.origin+"/v1",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    await expect(discover(provider,{SWITCHER_PROVIDER_TEST:"fixture"})).rejects.toMatchObject({code:"invalid_catalog"});
  } finally {await upstream.stop(true);}
});

test("presets without a documented model-list API fail closed instead of probing inference /models",async()=>{
  await expect(discover({...providerFromPreset("zai"),version:1,updatedAt:"now"})).rejects.toMatchObject({code:"catalog_unsupported"});
});

test("SiliconFlow discovery uses the official OpenAPI /models data catalog",async()=>{
  const requests:{path:string;auth:string|null}[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    const url=new URL(request.url); requests.push({path:url.pathname,auth:request.headers.get("authorization")});
    return Response.json({object:"list",data:[{id:"deepseek-ai/DeepSeek-V4-Flash",object:"model",created:0,owned_by:"deepseek-ai"},{id:"Qwen/Qwen3-32B",object:"model",created:0,owned_by:"Qwen"}]});
  }});
  try {
    const provider={...providerFromPreset("siliconflow",{baseUrl:upstream.url.origin+"/v1",catalogBaseUrl:upstream.url.origin+"/v1",credentialEnv:"SWITCHER_PROVIDER_TEST"}),version:1,updatedAt:"now"};
    const result=await discover(provider,{SWITCHER_PROVIDER_TEST:"fixture"});
    expect(result.models.map(model=>model.id)).toEqual(["deepseek-ai/DeepSeek-V4-Flash","Qwen/Qwen3-32B"]);
    expect(requests).toEqual([{path:"/v1/models",auth:"Bearer fixture"}]);
  } finally {await upstream.stop(true);}
});

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
