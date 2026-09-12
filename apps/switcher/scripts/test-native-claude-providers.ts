import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHarness, prepareHarnessLaunch } from "../src/harnesses";
import { childEnvironment } from "../src/harness-environment";
import { providerFromPreset } from "../src/presets";

// Real installed Claude, controlled upstream fixtures, and a real Read tool.
// No provider credentials, account data, browser, or native app UI is accessed.
const native = await detectHarness("claude");
if (!native.available) throw new Error("Install Claude Code to run this explicit native check.");
const root = await mkdtemp(join(tmpdir(), "switcher-native-claude-providers-"));
const originalFetch = globalThis.fetch;
const marker = `SWITCHER_NATIVE_${crypto.randomUUID().replaceAll("-", "")}_OK`;
const file = join(root, "work", "fixture.txt");
await mkdir(join(root, "work"));
await writeFile(file, marker + "\n", {mode: 0o600});
await writeFile(join(root, "mcp.json"), '{"mcpServers":{}}', {mode: 0o600});
const sse = (rows: any[]) => new Response(rows.map(row => `data: ${typeof row === "string" ? row : JSON.stringify(row)}\n\n`).join(""), {headers: {"content-type": "text/event-stream"}});
try {
  for (const [preset, model, wire] of [
    ["opencode", "big-pickle", "chat"], ["opencode", "gpt-5.6-luna", "responses"],
    ["opencode", "gemini-3.8-flash", "gemini"], ["opencode-go", "minimax-m3", "messages"],
    ["openrouter", "deepseek/deepseek-v4-flash", "messages"],
  ] as const) {
    const provider = providerFromPreset(preset, {harness: "claude"});
    let verified = false, calls = 0;
    const events: any[] = [];
    globalThis.fetch = (async (resource: any, init: any) => {
      const url = String(resource instanceof Request ? resource.url : resource);
      if (new URL(url).hostname === "127.0.0.1") return originalFetch(resource, init);
      if (!url.startsWith(provider.baseUrl + "/") || init?.method !== "POST") throw new Error("Unexpected external request in native fixture check.");
      calls++;
      const body = JSON.parse(init.body);
      const headers = new Headers(init.headers);
      if (preset !== "openrouter" && (!headers.get("x-opencode-session") || !headers.get("user-agent")?.startsWith("hasna-switcher/"))) throw new Error("Missing OpenCode session identity.");
      const auth = wire === "gemini" ? headers.get("x-goog-api-key") : wire === "messages" && preset !== "openrouter" ? headers.get("x-api-key") : headers.get("authorization")?.replace(/^Bearer /, "");
      if (auth !== "provider-fixture") throw new Error("Incorrect upstream credential translation.");
      const actualToolResult = wire === "chat" ? body.messages?.find((m: any) => m.role === "tool" && m.content?.includes(marker))
        : wire === "responses" ? body.input?.find((m: any) => m.type === "function_call_output" && m.output?.includes(marker))
        : wire === "gemini" ? body.contents?.flatMap((m: any) => m.parts ?? []).find((p: any) => p.functionResponse?.response?.result?.includes(marker))
        : body.messages?.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).find((p: any) => p.type === "tool_result" && JSON.stringify(p.content).includes(marker));
      if (actualToolResult && wire === "gemini" && !JSON.stringify(body.contents).includes('"thoughtSignature":"native-signature-fixture"')) throw new Error("Gemini tool signature was lost.");
      verified ||= !!actualToolResult;
      const hasTool = JSON.stringify(body.tools ?? []).includes('"Read"');
      const useTool = hasTool && !actualToolResult;
      const answer = actualToolResult ? marker : "Fixture title";
      const args = JSON.stringify({file_path: file});
      if (wire === "chat") {
        if (!url.endsWith("/chat/completions")) throw new Error("Wrong Chat endpoint.");
        const choice = {message: useTool ? {role:"assistant",content:null,tool_calls:[{id:"call_read",type:"function",function:{name:"Read",arguments:args}}]} : {role:"assistant",content:answer},finish_reason:useTool?"tool_calls":"stop"};
        return body.stream ? sse([{model,choices:[{delta:useTool?{tool_calls:[{index:0,...choice.message.tool_calls![0]}]}:{content:answer},finish_reason:choice.finish_reason}]},{choices:[],usage:{prompt_tokens:20,completion_tokens:5}},"[DONE]"])
          : Response.json({model,choices:[choice],usage:{prompt_tokens:20,completion_tokens:5}});
      }
      if (wire === "responses") {
        if (!url.endsWith("/responses")) throw new Error("Wrong Responses endpoint.");
        const output = useTool ? [{type:"function_call",call_id:"call_read",name:"Read",arguments:args}] : [{type:"message",role:"assistant",content:[{type:"output_text",text:answer}]}];
        const completed = {model,status:"completed",output,usage:{input_tokens:20,output_tokens:5}};
        return body.stream ? sse([...(useTool?[{type:"response.output_item.added",output_index:0,item:{...output[0],arguments:""}},{type:"response.function_call_arguments.delta",output_index:0,delta:args}]:[{type:"response.output_text.delta",delta:answer}]),{type:"response.completed",response:completed}]) : Response.json(completed);
      }
      if (wire === "gemini") {
        if (!url.includes(`/models/${model}:`)) throw new Error("Wrong Gemini endpoint.");
        const data = {candidates:[{content:{parts:useTool?[{functionCall:{name:"Read",args:{file_path:file}},thoughtSignature:"native-signature-fixture"}]:[{text:answer}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:5}};
        return url.includes("streamGenerateContent") ? sse([data]) : Response.json(data);
      }
      if (!new URL(url).pathname.endsWith("/messages")) throw new Error("Wrong Messages endpoint.");
      const content = useTool ? [{type:"tool_use",id:"call_read",name:"Read",input:{file_path:file}}] : [{type:"text",text:answer}];
      const message = {id:"msg_fixture",type:"message",role:"assistant",model,content,stop_reason:useTool?"tool_use":"end_turn",stop_sequence:null,usage:{input_tokens:20,output_tokens:5}};
      return body.stream ? sse([{type:"message_start",message:{...message,content:[],stop_reason:null}},{type:"content_block_start",index:0,content_block:useTool?{...content[0],input:{}}:{type:"text",text:""}},{type:"content_block_delta",index:0,delta:useTool?{type:"input_json_delta",partial_json:args}:{type:"text_delta",text:answer}},{type:"content_block_stop",index:0},{type:"message_delta",delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:message.usage},{type:"message_stop"}]) : Response.json(message);
    }) as typeof fetch;
    const state = join(root, preset + "-" + wire);
    await mkdir(state);
    const prepared = await prepareHarnessLaunch({harness:"claude",baseUrl:provider.baseUrl,protocol:provider.protocol,authStyle:provider.authStyle,credential:"provider-fixture",model,models:[{id:model,name:model,supportedParameters:["tools"]}],stateDir:state,cwd:join(root,"work"),executable:native.executable,version:native.version,onRoutingEvent:event=>events.push(event),
      args:["--print","--output-format","json","--strict-mcp-config","--mcp-config",join(root,"mcp.json"),"--tools","Read","--permission-mode","plan","--system-prompt","Use Read to answer file questions.","--max-turns","3","--no-session-persistence",`Read ${file} with the Read tool and reply with exactly its contents.`]});
    try {
      const child = Bun.spawn([prepared.executable,...prepared.args],{cwd:join(root,"work"),env:{...childEnvironment(),...prepared.env,CLAUDE_CONFIG_DIR:join(state,"claude"),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:"1"},stdout:"pipe",stderr:"pipe"});
      const timer = setTimeout(()=>child.kill("SIGTERM"),30_000);
      const [code, output, stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]).finally(()=>clearTimeout(timer));
      const result=JSON.parse(output.trim());
      if(code||result.is_error||result.result!==marker||!verified||result.num_turns!==2)throw new Error(`Native ${preset}/${wire} failed: ${result.result ?? stderr.slice(-300)}`);
      console.log(JSON.stringify({preset,model,wire,nativeVersion:native.version,turns:result.num_turns,realReadToolVerified:verified,upstream:"fixture",requests:calls}));
    } finally {await prepared.cleanup?.();}
  }
} finally {globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});}
