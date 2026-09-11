import { PassThrough, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
import { activateClientEnvironment } from "../lib/store/test-support/client-environment.js";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { registerTelegramChannel } from "./telegram-channel";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("telegram channel", () => {
  let originalToken: string | undefined;

  beforeEach(() => {
    originalToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    } else {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  });

  test("does not register tools when no token", () => {
    const server = new McpServer({ name: "test-tg-none", version: "0.0.1" });
    registerTelegramChannel(server);
    // No tools should be registered without token
  });

  test("returns early without token (no throw)", () => {
    const server = new McpServer({ name: "test-tg-early", version: "0.0.1" });
    expect(() => registerTelegramChannel(server)).not.toThrow();
  });
});


describe("stdio Telegram transport lifecycle", () => {
  test("import and build do not fetch; failed connection aborts startup; close stops polling", async () => {
    const fixture = await startLoopbackApiFixture();
    const restore = activateClientEnvironment(fixture.env);
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;
    const previousFetch = globalThis.fetch;
    const { buildServer, disposeServer } = await import("./index.js");
    const calls: string[] = [];
    let startupAborted = false;
    let holdStartup = true;
    process.env.TELEGRAM_BOT_TOKEN = crypto.randomUUID();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === fixture.url) return previousFetch(input, init);
      if (url.hostname !== "api.telegram.org") throw new Error("Unexpected test egress");
      const method = url.pathname.split("/").at(-1)!;
      calls.push(method);
      if (method === "getMe" && holdStartup) return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { startupAborted = true; reject(new Error("Fixture aborted")); }, {once:true});
      });
      return Response.json({ok:true,result:method === "getMe" ? {username:"fixture"} : []});
    }) as typeof fetch;
    const failed = buildServer();
    const connected = buildServer();
    try {
      expect(calls).toHaveLength(0);
      await expect(failed.connect({start:async()=>{throw new Error("Fixture connect failed");},send:async()=>{},close:async()=>{}})).rejects.toThrow("Fixture connect failed");
      expect(startupAborted).toBe(true);
      holdStartup = false;
      await connected.connect({start:async()=>{},send:async()=>{},close:async()=>{}});
      await Bun.sleep(4300);
      expect(calls.filter(method=>method === "getUpdates").length).toBeGreaterThan(0);
      await connected.close();
      const completed = calls.length;
      await expect(connected.connect({start:async()=>{},send:async()=>{},close:async()=>{}})).rejects.toThrow("one transport connection");
      expect(calls).toHaveLength(completed);
      await Bun.sleep(2200);
      expect(calls).toHaveLength(completed);
    } finally {
      await disposeServer(failed);
      await disposeServer(connected);
      globalThis.fetch = previousFetch;
      if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previousToken;
      try { await fixture.stop(); } finally { restore(); }
    }
  }, 20000);
});

test("Telegram retries rejected notifications and peer close drains both bridges", async () => {
  const fixture = await startLoopbackApiFixture();
  const restore = activateClientEnvironment(fixture.env);
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const {buildServer, disposeServer} = await import("./index.js");
  const {liveChannelBridgeCountForTests} = await import("./channel.js");
  const baseline = liveChannelBridgeCountForTests();
  const offsets:number[]=[];
  let rejected=0;
  let delivered=0;
  const transport:{start:()=>Promise<void>;send:(message:any)=>Promise<void>;close:()=>Promise<void>;onclose?:()=>void}={
    start:async()=>{}, close:async()=>{}, send:async(message:any)=>{
      if(message.method === "notifications/claude/channel" && message.params?.meta?.chat_id) {
        if(rejected===0) {rejected++;throw new Error("Synthetic delivery failure");}
        delivered++;
      }
    },
  };
  process.env.TELEGRAM_BOT_TOKEN=crypto.randomUUID();
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    if(url.origin===fixture.url)return previousFetch(input,init);
    if(url.hostname!=="api.telegram.org")throw new Error("Unexpected test egress");
    if(url.pathname.endsWith("/getMe"))return Response.json({ok:true,result:{username:"fixture"}});
    const offset=JSON.parse(String(init?.body)).offset;offsets.push(offset);
    return Response.json({ok:true,result:offset<=41?[{update_id:41,message:{message_id:1,chat:{id:7,type:"private"},text:"synthetic delivery"}}]:[]});
  }) as typeof fetch;
  const server=buildServer();
  try {
    await server.connect(transport);
    const deadline=Date.now()+12000;
    while(offsets.length<3 && Date.now()<deadline)await Bun.sleep(25);
    expect(offsets.slice(0,3)).toEqual([1,1,42]);
    expect(rejected).toBe(1);expect(delivered).toBe(1);
    expect(liveChannelBridgeCountForTests()).toBe(baseline+1);
    transport.onclose?.();
    await disposeServer(server);
    expect(liveChannelBridgeCountForTests()).toBe(baseline);
    const count=offsets.length;
    await Bun.sleep(2200);
    expect(offsets).toHaveLength(count);
  } finally {
    await disposeServer(server);
    globalThis.fetch=previousFetch;
    if(previousToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=previousToken;
    try{await fixture.stop();}finally{restore();}
  }
},25000);


test("real SDK stdio close resolves despite a backpressured notification writer", async()=>{
  const fixture=await startLoopbackApiFixture();const restore=activateClientEnvironment(fixture.env);
  const oldFetch=globalThis.fetch,oldToken=process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN=crypto.randomUUID();
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));if(url.origin===fixture.url)return oldFetch(input,init);
    if(url.hostname!=="api.telegram.org")throw new Error("Unexpected test egress");
    return Response.json({ok:true,result:url.pathname.endsWith("getMe")?{username:"fixture"}:[{update_id:41,message:{message_id:7,chat:{id:2,type:"private"},text:"fixture",date:1}}]});
  }) as typeof fetch;
  let release:(()=>void)|undefined;
  const output=new Writable({highWaterMark:1,write(_chunk,_encoding,callback){release=()=>{release=undefined;callback();};}});
  const input=new PassThrough();const transport=new StdioServerTransport(input,output);
  const {buildServer,disposeServer}=await import("./index.js");const server=buildServer();
  try{
    await server.connect(transport);const deadline=Date.now()+7000;
    while(!release&&Date.now()<deadline)await Bun.sleep(20);
    expect(release).toBeDefined();
    const outcome=await Promise.race([server.close().then(()=>"closed"),Bun.sleep(500).then(()=>"timeout")]);
    expect(outcome).toBe("closed");
    expect(server.server.transport).toBeUndefined();
  }finally{
    release?.();await disposeServer(server);input.destroy();output.destroy();globalThis.fetch=oldFetch;
    if(oldToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=oldToken;
    try{await fixture.stop();}finally{restore();}
  }
},15000);
