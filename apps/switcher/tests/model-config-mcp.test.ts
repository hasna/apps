import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import { createHandler } from "../src/service";
import { SwitcherClient } from "../src/sdk";
test("MCP model tools persist validated edits through the authenticated API",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"switcher-model-mcp-"));const store=await Store.open({sqlitePath:join(dir,"store.db")});
  const key="mcp-model-config-fixture-operator";const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:createHandler(store,key)});
  const api=new SwitcherClient({baseUrl:server.url.origin,apiKey:key});
  const transport=new StdioClientTransport({command:process.execPath,args:[new URL("../src/mcp.ts",import.meta.url).pathname],env:{PATH:process.env.PATH??"",HOME:dir,HASNA_STATION:"switcher-model-mcp-fixture",HASNA_SWITCHER_API_URL:server.url.origin,HASNA_SWITCHER_API_KEY:key},stderr:"pipe"});
  const client=new Client({name:"model-config-fixture",version:"1.0.0"});
  try{
    await api.createProvider({id:"manual",name:"Manual",baseUrl:"https://inference.example/v1",protocol:"openai-chat",catalogFormat:"none"});
    await client.connect(transport);
    const names=(await client.listTools()).tools.map(tool=>tool.name);expect(names).toContain("models_add");expect(names).toContain("models_update");expect(names).toContain("models_remove");
    const added=await client.callTool({name:"models_add",arguments:{providerId:"manual",model:{id:"new",name:"New"}}});expect(added.isError).not.toBe(true);
    expect((await api.getProvider("manual")).manualModels).toEqual([{id:"new",name:"New"}]);
    const updated=await client.callTool({name:"models_update",arguments:{providerId:"manual",model:{id:"new",name:"Updated",contextWindow:32000}}});expect(updated.isError).not.toBe(true);
    expect((await api.getProvider("manual")).manualModels[0].contextWindow).toBe(32000);
    const removed=await client.callTool({name:"models_remove",arguments:{providerId:"manual",modelId:"new"}});expect(removed.isError).not.toBe(true);
    expect((await api.getProvider("manual")).manualModels).toEqual([]);
  }finally{await client.close();await transport.close();await server.stop(true);await store.close();await rm(dir,{recursive:true,force:true});}
},15000);

test("MCP hosted refresh resolves the station credential locally and saves only catalog metadata",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"switcher-model-mcp-hosted-"));const store=await Store.open({sqlitePath:join(dir,"store.db")});
  const apiKey="mcp-hosted-switcher-api-token";const providerKey="mcp-hosted-provider-key-not-serialized";const paths:string[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    const path=new URL(request.url).pathname;paths.push(path);
    if(request.headers.get("authorization")!==`Bearer ${providerKey}`)return new Response(null,{status:401});
    return path==="/auth"?Response.json({ok:true}):path==="/models"?Response.json({data:[{id:"mcp-hosted-model",supported_parameters:["tools"]}]}):new Response(null,{status:404});
  }});
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:createHandler(store,apiKey,{})});
  const api=new SwitcherClient({baseUrl:server.url.origin,apiKey});
  const transport=new StdioClientTransport({command:process.execPath,args:[new URL("../src/mcp.ts",import.meta.url).pathname],env:{PATH:process.env.PATH??"",HOME:dir,HASNA_STATION:"switcher-model-mcp-hosted",HASNA_SWITCHER_API_URL:server.url.origin,HASNA_SWITCHER_API_KEY:apiKey,SWITCHER_PROVIDER_MCP_HOSTED:providerKey},stderr:"pipe"});
  const client=new Client({name:"model-config-hosted-fixture",version:"1.0.0"});
  try{
    await api.createProvider({id:"mcp-hosted",name:"MCP hosted",baseUrl:upstream.url.origin,protocol:"openai-chat",credentialEnv:"SWITCHER_PROVIDER_MCP_HOSTED",credentialCheck:{method:"GET",path:"auth"}});
    await client.connect(transport);
    const refreshed=await client.callTool({name:"models_refresh",arguments:{id:"mcp-hosted"}});expect(refreshed.isError).not.toBe(true);
    expect(paths).toEqual(["/auth","/models"]);
    expect((await api.listModels("mcp-hosted")).data.map(model=>model.id)).toEqual(["mcp-hosted-model"]);
    expect(JSON.stringify(refreshed)).not.toContain(providerKey);
  }finally{await client.close();await transport.close();await server.stop(true);await upstream.stop(true);await store.close();await rm(dir,{recursive:true,force:true});}
},15000);
