import { expect, test } from "bun:test";
import { providerFromPreset, providerCredential } from "../src/presets";
import { openCodeHeaders, openCodeLane, openCodeWire, prepareOpenCodeMessages } from "../src/opencode";
import { discover } from "../src/catalog";

const base = "https://opencode.ai/zen/v1";
const request = (model: string, stream = false) => ({model, stream, max_tokens: 100, system: [{type: "text", text: "System", cache_control: {type: "ephemeral"}}],
  messages: [{role: "user", content: "Use the tool"}, {role: "assistant", content: [{type: "tool_use", id: "call_1", name: "sum", input: {a: 1}}]},
    {role: "user", content: [{type: "tool_result", tool_use_id: "call_1", content: [{type: "text", text: "2"}]}, {type: "text", text: "Answer"}]}],
  tools: [{name: "sum", description: "Sum", input_schema: {type: "object", properties: {a: {type: "number"}}}}]});
const events = (rows: any[]) => new Response(rows.map(row => `data: ${typeof row === "string" ? row : JSON.stringify(row)}\n\n`).join(""), {headers: {"content-type": "text/event-stream"}});

test("OpenCode and Go use their full public catalogs with protocol-specific credentials", () => {
  for (const id of ["opencode", "opencode-go"]) {
    const claude = providerFromPreset(id, {harness: "claude"});
    expect(claude.baseUrl).toBe(id === "opencode" ? base : "https://opencode.ai/zen/go/v1");
    expect(claude.protocol).toBe("anthropic-messages");
    expect(claude.authStyle).toBe("x-api-key");
    expect(claude.catalogAuthStyle).toBe("none");
    expect(claude.manualModels).toEqual([]);
    expect(providerFromPreset(id, {harness: "codex"}).protocol).toBe("openai-responses");
    expect(providerCredential(claude, {OPENCODE_API_KEY: "fixture"})).toBe("fixture");
    expect(providerCredential({...claude, baseUrl: "https://elsewhere.example/v1"}, {OPENCODE_API_KEY: "fixture"})).toBeUndefined();
  }
});

test("OpenCode translation and session headers are confined to its exact inference prefixes", () => {
  expect(openCodeLane(base)).toBe("zen");
  for (const url of ["https://opencode.ai/other", "https://opencode.ai.attacker.example/zen/v1", "https://other.example/zen/v1"])
    expect(openCodeLane(url)).toBeUndefined();
  const headers = new Headers({"x-client-session-id": "conversation-1", "authorization": "private", "cookie": "private", "user-agent": "untrusted"});
  const result = openCodeHeaders(base, headers, {}, "launch");
  expect(result["x-opencode-session"]).toBe("conversation-1");
  expect(result["user-agent"]).toStartWith("hasna-switcher/");
  expect(result.authorization).toBeUndefined(); expect(result.cookie).toBeUndefined();
  expect(openCodeHeaders("https://elsewhere.example/v1", headers, {}, "launch")).toEqual({});
  expect(openCodeHeaders(base, new Headers(), {metadata: {user_id: JSON.stringify({session_id: "native-session", account: "private"})}}, "launch")["x-opencode-session"]).toBe("native-session");
  expect(openCodeHeaders(base, new Headers(), {}, "launch")["x-opencode-session"]).toBe("launch");
  expect(openCodeWire("qwen3.7-plus", "zen")).toBe("messages");
  expect(openCodeWire("minimax-m3", "go")).toBe("messages");
  expect(openCodeWire("minimax-m3", "zen")).toBe("chat");
});

test("Claude tool history is translated to each OpenCode native wire", () => {
  const chat = prepareOpenCodeMessages(base, request("big-pickle"), "/messages", "fixture")!;
  expect(chat.path).toBe("/chat/completions"); expect(chat.auth).toEqual({authorization: "Bearer fixture"});
  expect(chat.body.messages[2].tool_calls[0].function.arguments).toBe('{"a":1}');
  expect(chat.body.messages[3]).toEqual({role: "tool", tool_call_id: "call_1", content: "2"});
  expect(chat.body.messages[4].content[0].text).toBe("Answer");
  const responses = prepareOpenCodeMessages(base, request("gpt-5.6-luna"), "/messages", "fixture")!;
  expect(responses.path).toBe("/responses");
  expect(responses.body.input.some((part: any) => part.type === "function_call" && part.call_id === "call_1")).toBe(true);
  expect(responses.body.input.some((part: any) => part.type === "function_call_output" && part.output === "2")).toBe(true);
  expect(responses.body.tools[0].name).toBe("sum");
  const gemini = prepareOpenCodeMessages(base, request("gemini-3.8-flash"), "/messages", "fixture")!;
  expect(gemini.path).toBe("/models/gemini-3.8-flash:generateContent");
  expect(gemini.auth).toEqual({"x-goog-api-key": "fixture"});
  expect(gemini.body.contents[2].parts[0].functionResponse.name).toBe("sum");
  expect(prepareOpenCodeMessages(base, request("claude-sonnet-4-6"), "/messages", "fixture")).toBeUndefined();
});

test("translation fails explicitly for unsupported server tools and token counting", () => {
  expect(() => prepareOpenCodeMessages(base, {...request("big-pickle"), tools: [{type: "web_search_20250305", name: "web_search"}]}, "/messages")).toThrow("server tool");
  expect(() => prepareOpenCodeMessages(base, request("big-pickle"), "/messages/count_tokens")).toThrow("token counting");
});

test("nonstreaming native responses preserve text, tools, reasoning and usage", async () => {
  const chat = prepareOpenCodeMessages(base, request("big-pickle"), "/messages")!;
  const response = await chat.response(Response.json({model: "big-pickle", choices: [{message: {content: "Done", reasoning_content: "Think", tool_calls: [{id: "call_2", function: {name: "sum", arguments: '{"a":2}'}}]}, finish_reason: "tool_calls"}], usage: {prompt_tokens: 12, completion_tokens: 8}}));
  const data = await response.json();
  expect(data.content.map((part: any) => part.type)).toEqual(["thinking", "text", "tool_use"]);
  expect(data.content[2].input).toEqual({a: 2}); expect(data.stop_reason).toBe("tool_use");
  expect(data.usage).toEqual({input_tokens: 12, output_tokens: 8});
  const failed = Response.json({error: "fixture"}, {status: 401}); expect(await chat.response(failed)).toBe(failed);
});

test("Chat streaming preserves partial tool arguments and trailing usage", async () => {
  const adapter = prepareOpenCodeMessages(base, request("big-pickle", true), "/messages")!;
  const response = await adapter.response(events([
    {choices: [{delta: {reasoning_content: "Think"}}]},
    {choices: [{delta: {tool_calls: [{index: 0, id: "call_2", function: {name: "sum", arguments: '{"a":'}}]}}]},
    {choices: [{delta: {tool_calls: [{index: 0, function: {arguments: "2}"}}]}, finish_reason: "tool_calls"}]},
    {choices: [], usage: {prompt_tokens: 9, completion_tokens: 4}}, "[DONE]",
  ]));
  const text = await response.text();
  expect(text).toContain('"partial_json":"{\\"a\\":"'); expect(text).toContain('"partial_json":"2}"');
  expect(text).toContain('"stop_reason":"tool_use"'); expect(text).toContain('"input_tokens":9');
  expect(text).toContain("event: message_stop");
});

test("Responses and Gemini streaming preserve native tools and terminal status", async () => {
  const adapter = prepareOpenCodeMessages(base, request("gpt-5.6-luna", true), "/messages")!;
  const response = await adapter.response(events([
    {type: "response.output_item.added", output_index: 0, item: {type: "function_call", call_id: "call_2", name: "sum"}},
    {type: "response.function_call_arguments.delta", output_index: 0, delta: '{"a":2}'},
    {type: "response.completed", response: {usage: {input_tokens: 10, output_tokens: 4}}},
  ]));
  const text = await response.text(); expect(text).toContain('"id":"call_2"'); expect(text).toContain('"stop_reason":"tool_use"');
  const gemini = prepareOpenCodeMessages(base, request("gemini-3.8-flash", true), "/messages")!;
  const native = await gemini.response(events([{candidates: [{content: {parts: [{text: "Answer"}]}, finishReason: "STOP"}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 2}}]));
  expect(await native.text()).toContain('"text":"Answer"');
});

test("truncated or failed streams never claim a successful message_stop", async () => {
  const adapter = prepareOpenCodeMessages(base, request("big-pickle", true), "/messages")!;
  const response = await adapter.response(events([{choices: [{delta: {content: "Partial"}}]}]));
  await expect(response.text()).rejects.toThrow("before completion");
});

test("native system messages and image-bearing error results survive translation", () => {
  const body=request("big-pickle");
  body.messages.unshift({role:"system",content:"Native system"} as any);
  body.messages.at(-1)!.content=[{type:"tool_result",tool_use_id:"call_1",is_error:true,content:[{type:"text",text:"Failed"},{type:"image",source:{type:"base64",media_type:"image/png",data:"fixture"}}]}] as any;
  const chat=prepareOpenCodeMessages(base,body,"/messages")!.body;
  expect(chat.messages[1]).toEqual({role:"system",content:"Native system"});
  expect(chat.messages.find((m:any)=>m.role==="tool").content).toBe("[Tool error] Failed");
  expect(chat.messages.at(-1).content.some((part:any)=>part.image_url?.url==="data:image/png;base64,fixture")).toBe(true);
  const gemini=prepareOpenCodeMessages(base,{...body,model:"gemini-3.8-flash"},"/messages")!.body;
  expect(gemini.systemInstruction.parts).toEqual([{text:"System"},{text:"Native system"}]);
});

test("Gemini tool thought signatures survive a second native request",async()=>{
  const state=new Map<string,string>();
  const adapter=prepareOpenCodeMessages(base,request("gemini-3.8-flash"),"/messages",undefined,state)!;
  const result=await (await adapter.response(Response.json({candidates:[{content:{parts:[{functionCall:{name:"sum",args:{a:2}},thoughtSignature:"opaque-native-signature"}]},finishReason:"STOP"}]}))).json();
  const call=result.content[0];
  const next=prepareOpenCodeMessages(base,{...request("gemini-3.8-flash"),messages:[{role:"assistant",content:[call]},{role:"user",content:[{type:"tool_result",tool_use_id:call.id,content:"3"}]}]},"/messages",undefined,state)!;
  expect(next.body.contents[0].parts[0].thoughtSignature).toBe("opaque-native-signature");
  expect(next.body.contents[1].parts[0].functionResponse.name).toBe("sum");
});

test("split CRLF and UTF-8 SSE frames preserve text",async()=>{
  const adapter=prepareOpenCodeMessages(base,request("big-pickle",true),"/messages")!;
  const bytes=new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:"Héllo"},finish_reason:"stop"}]})+'\r\n\r\ndata: [DONE]\r\n\r\n');
  let offset=0;
  const native=new Response(new ReadableStream({pull(c){if(offset<bytes.length)c.enqueue(bytes.slice(offset,++offset));else c.close();}}),{headers:{"content-type":"text/event-stream"}});
  expect(await (await adapter.response(native)).text()).toContain('"text":"Héllo"');
});

test("catalog discovery retains every page and provider-declared reasoning levels",async()=>{
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    expect(request.headers.get("user-agent")).toStartWith("hasna-switcher/");
    return Response.json(new URL(request.url).searchParams.has("after_id")?{data:[{id:"image-model",architecture:{output_modalities:["image"]}}],has_more:false,total_count:2}
      :{data:[{id:"reasoner",reasoning:{supported_efforts:["none","low","high","max"]},supported_parameters:["tools"]}],has_more:true,last_id:"reasoner"});
  }});
  try{
    const provider={...providerFromPreset("openrouter",{harness:"claude",baseUrl:upstream.url.origin+"/v1",credentialEnv:"SWITCHER_PROVIDER_FIXTURE"}),version:1,updatedAt:"now"};
    const catalog=await discover(provider,{});
    expect(catalog.models).toHaveLength(2);
    expect(catalog.models[0].reasoningEfforts).toEqual(["none","low","high","max"]);
    expect(catalog.models[1].outputModalities).toEqual(["image"]);
  }finally{await upstream.stop(true);}
});
