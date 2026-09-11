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
