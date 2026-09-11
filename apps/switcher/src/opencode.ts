import { Fault, VERSION } from "./domain";
import { boundedJson } from "./http";

type Wire = "messages" | "chat" | "responses" | "gemini";
type Json = Record<string, any>;
export type OpenCodeTranslationState = Map<string, string>;

function rememberGeminiTool(part: Json, state: OpenCodeTranslationState): string {
  const id = `call_${crypto.randomUUID()}`;
  if (typeof part.thoughtSignature === "string") {
    if (part.thoughtSignature.length > 65536 || state.size >= 2000) throw new Fault(502, "opencode_signature_limit", "Gemini tool continuation metadata exceeded the launch limit.");
    state.set(id, part.thoughtSignature);
  }
  return id;
}

/** OpenCode owns these two prefixes; custom URLs never inherit this adapter. */
export function openCodeLane(baseUrl: string): "zen" | "go" | undefined {
  const url = new URL(baseUrl);
  if (url.origin !== "https://opencode.ai") return;
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/zen/v1" ? "zen" : path === "/zen/go/v1" ? "go" : undefined;
}

/** Native endpoint families documented by OpenCode, not a frozen model list.
 * Their default OpenAI-compatible adapter serves the remaining model families.
 * https://opencode.ai/docs/zen/ and https://opencode.ai/docs/go/
 */
export function openCodeWire(model: string, lane: "zen" | "go"): Wire {
  if (/^claude-/.test(model) || /^qwen3\.(5|6|7|8)-/.test(model) || lane === "go" && /^minimax-/.test(model)) return "messages";
  if (/^(gpt-|grok-|muse-spark-)/.test(model)) return "responses";
  if (/^gemini-/.test(model)) return "gemini";
  return "chat";
}

/** Forward only conversation identifiers, never arbitrary client headers.
 * Switcher identifies itself honestly even when a native user agent is absent.
 */
export function openCodeHeaders(baseUrl: string, source: Headers, body: Json, launchSession: string): Record<string, string> {
  if (!openCodeLane(baseUrl)) return {};
  const result: Record<string, string> = {"user-agent": `hasna-switcher/${VERSION}`};
  const names = ["x-opencode-session", "x-client-session-id", "x-session-id", "session_id", "x-codex-thread-id"];
  for (const name of names) {
    const value = source.get(name);
    if (value && /^[A-Za-z0-9._:-]{1,200}$/.test(value)) result[name] = value;
  }
  let session = names.map(name => result[name]).find(Boolean);
  if (!session && typeof body.metadata?.user_id === "string") {
    // Recent Claude uses JSON; older releases used ..._session_<uuid>.
    try { const value = JSON.parse(body.metadata.user_id)?.session_id; if (typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value)) session = value; } catch {}
    session ??= /_session_([a-f0-9-]{36})$/i.exec(body.metadata.user_id)?.[1];
  }
  result["x-opencode-session"] = session ?? launchSession;
  return result;
}

function unsupported(feature: string): never {
  throw new Fault(422, "opencode_translation_unsupported", `The selected OpenCode model cannot receive this Claude feature: ${feature}.`);
}

function blocks(value: unknown): Json[] {
  if (typeof value === "string") return [{type: "text", text: value}];
  if (Array.isArray(value) && value.every(item => item && typeof item === "object")) return value;
  return unsupported("malformed content");
}

function imageUrl(block: Json): string {
  if (block.source?.type === "url" && typeof block.source.url === "string") return block.source.url;
  if (block.source?.type === "base64" && typeof block.source.data === "string" && typeof block.source.media_type === "string")
    return `data:${block.source.media_type};base64,${block.source.data}`;
  return unsupported("image source");
}

function textContent(value: unknown): string {
  return blocks(value).map(block => block.type === "text" && typeof block.text === "string" ? block.text : unsupported("non-text tool result")).join("\n");
}

function toolResult(part: Json): {text: string; images: Json[]} {
  const content = blocks(part.content ?? ""), images = content.filter(block => block.type === "image");
  const text = textContent(content.filter(block => block.type !== "image"));
  return {text: (part.is_error ? "[Tool error] " : "") + text, images};
}

function chatContent(value: unknown): Json[] {
  return blocks(value).flatMap<Json>(block => {
    if (block.type === "text" && typeof block.text === "string") return [{type: "text", text: block.text}];
    if (block.type === "image") return [{type: "image_url", image_url: {url: imageUrl(block)}}];
    if (block.type === "thinking" || block.type === "redacted_thinking") return [];
    return unsupported(`content block ${String(block.type)}`);
  });
}

function toChat(body: Json): Json {
  const messages: Json[] = [];
  if (body.system) messages.push({role: "system", content: textContent(body.system)});
  if (!Array.isArray(body.messages)) unsupported("missing messages");
  for (const message of body.messages) {
    if (["system", "developer"].includes(message.role)) { messages.push({role: "system", content: textContent(message.content)}); continue; }
    if (!["user", "assistant"].includes(message.role)) unsupported("message role");
    const parts = blocks(message.content);
    if (message.role === "assistant") {
      const calls = parts.filter(part => part.type === "tool_use").map(part => ({id: part.id, type: "function", function: {name: part.name, arguments: JSON.stringify(part.input ?? {})}}));
      const content = chatContent(parts.filter(part => part.type !== "tool_use"));
      const thinking = parts.filter(part => part.type === "thinking").map(part => part.thinking ?? "").join("");
      messages.push({role: "assistant", content: content.length ? content : null, ...(calls.length ? {tool_calls: calls} : {}), ...(thinking ? {reasoning_content: thinking} : {})});
    } else {
      // Tool results must immediately follow their assistant calls. Preserve
      // any subsequent user text/images as a separate native message.
      const images: Json[] = [];
      for (const part of parts.filter(part => part.type === "tool_result")) {
        const result = toolResult(part);
        messages.push({role: "tool", tool_call_id: part.tool_use_id, content: result.text});
        if (result.images.length) images.push({type: "text", text: `Images returned by tool call ${part.tool_use_id}:`}, ...result.images);
      }
      const content = chatContent([...images, ...parts.filter(part => part.type !== "tool_result")]);
      if (content.length) messages.push({role: "user", content});
    }
  }
  const tools = body.tools?.map((tool: Json) => {
    if (tool.type && tool.type !== "custom") unsupported(`server tool ${tool.type}`);
    if (!tool.name || !tool.input_schema) unsupported("tool schema");
    return {type: "function", function: {name: tool.name, description: tool.description, parameters: tool.input_schema}};
  });
  const choice = body.tool_choice;
  const tool_choice = !choice ? undefined : choice.type === "tool" ? {type: "function", function: {name: choice.name}}
    : choice.type === "any" ? "required" : ["auto", "none"].includes(choice.type) ? choice.type : unsupported("tool choice");
  const result: Json = {model: body.model, messages, max_tokens: body.max_tokens, stream: !!body.stream,
    ...(tools?.length ? {tools, tool_choice} : {}), ...(choice?.disable_parallel_tool_use ? {parallel_tool_calls: false} : {})};
  for (const key of ["temperature", "top_p"]) if (body[key] !== undefined) result[key] = body[key];
  if (body.stop_sequences) result.stop = body.stop_sequences;
  const effort = body.output_config?.effort;
  if (effort) result.reasoning_effort = effort;
  if (body.thinking?.type === "disabled") result.thinking = {type: "disabled"};
  else if (body.thinking?.type === "enabled" || body.thinking?.type === "adaptive") result.thinking = {type: "enabled"};
  if (result.stream) result.stream_options = {include_usage: true};
  return result;
}

function toResponses(chat: Json): Json {
  const input: Json[] = [];
  let instructions = "";
  for (const message of chat.messages) {
    if (message.role === "system") { instructions += (instructions ? "\n\n" : "") + message.content; continue; }
    if (message.role === "tool") { input.push({type: "function_call_output", call_id: message.tool_call_id, output: message.content}); continue; }
    if (message.content?.length) input.push({role: message.role, content: message.content.map((part: Json) => part.type === "image_url"
      ? {type: "input_image", image_url: part.image_url.url} : {type: message.role === "assistant" ? "output_text" : "input_text", text: part.text})});
    for (const call of message.tool_calls ?? []) input.push({type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments});
  }
  const result: Json = {model: chat.model, input, instructions, stream: chat.stream, max_output_tokens: chat.max_tokens, store: false};
  if (chat.tools) result.tools = chat.tools.map((tool: Json) => ({type: "function", ...tool.function}));
  if (chat.tool_choice) result.tool_choice = typeof chat.tool_choice === "string" ? chat.tool_choice : {type: "function", name: chat.tool_choice.function.name};
  for (const key of ["temperature", "top_p", "parallel_tool_calls"]) if (chat[key] !== undefined) result[key] = chat[key];
  if (chat.reasoning_effort || chat.thinking?.type === "disabled") result.reasoning = {effort: chat.thinking?.type === "disabled" ? "none" : chat.reasoning_effort};
  if (chat.stop) unsupported("stop sequences on Responses");
  return result;
}

function toGemini(chat: Json, state: OpenCodeTranslationState): Json {
  const contents: Json[] = [], names = new Map<string, string>();
  let systemInstruction: Json | undefined;
  for (const message of chat.messages) {
    if (message.role === "system") { systemInstruction ??= {parts: []}; systemInstruction.parts.push({text: message.content}); continue; }
    if (message.role === "tool") {
      const name = names.get(message.tool_call_id);
      if (!name) unsupported("unpaired tool result");
      contents.push({role: "user", parts: [{functionResponse: {name, response: {result: message.content}}}]}); continue;
    }
    const parts: Json[] = (message.content ?? []).map((part: Json) => {
      if (part.type === "text") return {text: part.text};
      const url = part.image_url.url, match = /^data:([^;]+);base64,(.+)$/s.exec(url);
      return match ? {inlineData: {mimeType: match[1], data: match[2]}} : {fileData: {fileUri: url}};
    });
    for (const call of message.tool_calls ?? []) {
      names.set(call.id, call.function.name);
      parts.push({functionCall: {name: call.function.name, args: JSON.parse(call.function.arguments)}, ...(state.has(call.id) ? {thoughtSignature: state.get(call.id)} : {})});
    }
    contents.push({role: message.role === "assistant" ? "model" : "user", parts});
  }
  const generationConfig: Json = {maxOutputTokens: chat.max_tokens};
  if (chat.temperature !== undefined) generationConfig.temperature = chat.temperature;
  if (chat.top_p !== undefined) generationConfig.topP = chat.top_p;
  if (chat.stop) generationConfig.stopSequences = chat.stop;
  if (chat.reasoning_effort) generationConfig.thinkingConfig = {thinkingLevel: chat.reasoning_effort.toUpperCase()};
  const result: Json = {contents, systemInstruction, generationConfig};
  if (chat.tools) result.tools = [{functionDeclarations: chat.tools.map((tool: Json) => ({name: tool.function.name, description: tool.function.description, parametersJsonSchema: tool.function.parameters}))}];
  if (chat.tool_choice) result.toolConfig = {functionCallingConfig: typeof chat.tool_choice === "object"
    ? {mode: "ANY", allowedFunctionNames: [chat.tool_choice.function.name]} : {mode: ({auto: "AUTO", required: "ANY", none: "NONE"} as Json)[chat.tool_choice]}};
  return result;
}

const stopReason = (reason: string | undefined, hasTools: boolean) => hasTools ? "tool_use" : ["length", "max_tokens", "max_output_tokens", "MAX_TOKENS"].includes(reason ?? "") ? "max_tokens" : "end_turn";
function usage(data: Json, wire: Wire) {
  const value = wire === "gemini" ? data.usageMetadata ?? {} : data.usage ?? {};
  return {input_tokens: value.input_tokens ?? value.prompt_tokens ?? value.promptTokenCount ?? 0,
    output_tokens: value.output_tokens ?? value.completion_tokens ?? ((value.candidatesTokenCount ?? 0) + (value.thoughtsTokenCount ?? 0))};
}
function toolInput(value: string): Json {
  try { return JSON.parse(value || "{}"); } catch { throw new Fault(502, "invalid_provider_response", "Provider returned malformed tool arguments."); }
}
function fromJson(data: Json, wire: Wire, model: string, state: OpenCodeTranslationState): Json {
  const content: Json[] = [];
  let reason: string | undefined;
  if (wire === "chat") {
    const choice = data.choices?.[0], message = choice?.message;
    if (!message) throw new Fault(502, "invalid_provider_response", "Provider returned no completion.");
    if (message.reasoning_content ?? message.reasoning) content.push({type: "thinking", thinking: message.reasoning_content ?? message.reasoning, signature: ""});
    if (message.content) content.push({type: "text", text: message.content});
    for (const tool of message.tool_calls ?? []) content.push({type: "tool_use", id: tool.id, name: tool.function.name, input: toolInput(tool.function.arguments)});
    reason = choice.finish_reason;
  } else if (wire === "responses") {
    if (!["completed", "incomplete"].includes(data.status)) throw new Fault(502, "invalid_provider_response", "Provider response did not complete.");
    for (const item of data.output ?? []) {
      if (item.type === "message") for (const part of item.content ?? []) if (part.type === "output_text") content.push({type: "text", text: part.text});
      if (item.type === "function_call") content.push({type: "tool_use", id: item.call_id, name: item.name, input: toolInput(item.arguments)});
      if (item.type === "reasoning") for (const part of item.summary ?? []) content.push({type: "thinking", thinking: part.text, signature: ""});
    }
    reason = data.incomplete_details?.reason;
  } else {
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Fault(502, "invalid_provider_response", "Provider returned no candidate.");
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) content.push(part.thought ? {type: "thinking", thinking: part.text, signature: ""} : {type: "text", text: part.text});
      if (part.functionCall) content.push({type: "tool_use", id: rememberGeminiTool(part, state), name: part.functionCall.name, input: part.functionCall.args ?? {}});
    }
    reason = candidate.finishReason;
  }
  return {id: `msg_${crypto.randomUUID()}`, type: "message", role: "assistant", model: data.model ?? data.modelVersion ?? model,
    content, stop_reason: stopReason(reason, content.some(part => part.type === "tool_use")), stop_sequence: null, usage: usage(data, wire)};
}

/** Translate SSE incrementally, including tool argument deltas and usage. A
 * truncated upstream must never become a successful Claude message_stop.
 */
function fromStream(response: Response, wire: Wire, model: string, state: OpenCodeTranslationState): Response {
  const reader = response.body!.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
  let buffer = "", ended = false, started = false, index = 0, reason: string | undefined;
  let tokens = {input_tokens: 0, output_tokens: 0};
  const active = new Map<string, {index: number; tool: boolean}>();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const send = (event: Json) => controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      const start = () => { if (!started) { started = true; send({type: "message_start", message: {id: `msg_${crypto.randomUUID()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: tokens}}); } };
      const part = (key: string, block: Json, delta?: Json) => {
        start(); let current = active.get(key);
        if (!current) { current = {index: index++, tool: block.type === "tool_use"}; active.set(key, current); send({type: "content_block_start", index: current.index, content_block: block}); }
        if (delta) send({type: "content_block_delta", index: current.index, delta});
      };
      const text = (value: string, thinking = false) => { if (value) part(thinking ? "thinking" : "text", thinking ? {type: "thinking", thinking: "", signature: ""} : {type: "text", text: ""}, thinking ? {type: "thinking_delta", thinking: value} : {type: "text_delta", text: value}); };
      const finish = () => {
        start(); for (const item of active.values()) send({type: "content_block_stop", index: item.index});
        send({type: "message_delta", delta: {stop_reason: stopReason(reason, [...active.values()].some(item => item.tool)), stop_sequence: null}, usage: tokens});
        send({type: "message_stop"}); ended = true; controller.close(); void reader.cancel().catch(() => {});
      };
      try {
        const chunk = await reader.read();
        if (chunk.done) { if (!ended) throw new Error("OpenCode stream ended before completion"); return; }
        buffer = (buffer + decoder.decode(chunk.value, {stream: true})).replace(/\r\n/g, "\n");
        if (buffer.length > 4 * 1024 * 1024) throw new Error("OpenCode SSE event too large");
        let end: number;
        while (!ended && (end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const payload = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (!payload) continue;
          if (payload === "[DONE]") { if (wire !== "chat" || !reason) throw new Error("Missing completion reason"); finish(); break; }
          const data = JSON.parse(payload);
          if (data.error || data.type === "error" || data.type === "response.failed") throw new Error("OpenCode provider stream failed");
          if (wire === "chat") {
            if (data.usage) tokens = usage(data, wire);
            const choice = data.choices?.[0], delta = choice?.delta;
            if (choice?.finish_reason) reason = choice.finish_reason;
            if (!delta) continue;
            text(delta.reasoning_content ?? delta.reasoning ?? "", true); text(delta.content ?? "");
            for (const call of delta.tool_calls ?? []) {
              const key = `tool-${call.index}`;
              if (!active.has(key) && (!call.id || !call.function?.name)) throw new Error("Incomplete tool start");
              part(key, {type: "tool_use", id: call.id, name: call.function?.name, input: {}}, call.function?.arguments ? {type: "input_json_delta", partial_json: call.function.arguments} : undefined);
            }
          } else if (wire === "responses") {
            if (data.type === "response.output_text.delta") text(data.delta);
            if (data.type === "response.reasoning_summary_text.delta") text(data.delta, true);
            if (data.type === "response.output_item.added" && data.item?.type === "function_call") part(`tool-${data.output_index}`, {type: "tool_use", id: data.item.call_id, name: data.item.name, input: {}});
            if (data.type === "response.function_call_arguments.delta") {
              const current = active.get(`tool-${data.output_index}`); if (!current) throw new Error("Missing tool start");
              send({type: "content_block_delta", index: current.index, delta: {type: "input_json_delta", partial_json: data.delta}});
            }
            if (["response.completed", "response.incomplete"].includes(data.type)) { tokens = usage(data.response ?? {}, wire); reason = data.response?.incomplete_details?.reason; finish(); }
          } else {
            if (data.usageMetadata) tokens = usage(data, wire);
            const candidate = data.candidates?.[0];
            for (const item of candidate?.content?.parts ?? []) {
              if (item.text) text(item.text, !!item.thought);
              if (item.functionCall) part(`tool-${index}`, {type: "tool_use", id: rememberGeminiTool(item, state), name: item.functionCall.name, input: {}}, {type: "input_json_delta", partial_json: JSON.stringify(item.functionCall.args ?? {})});
            }
            if (candidate?.finishReason) { reason = candidate.finishReason; finish(); }
          }
        }
        if (!ended) controller.enqueue(encoder.encode(": upstream activity\n\n"));
      } catch (error) { ended = true; controller.error(error); void reader.cancel().catch(() => {}); }
    },
    async cancel() { ended = true; await reader.cancel().catch(() => {}); },
  });
  return new Response(stream, {headers: {"content-type": "text/event-stream", "cache-control": "no-store"}});
}

export function prepareOpenCodeMessages(baseUrl: string, body: Json, suffix: string, credential?: string, state: OpenCodeTranslationState = new Map()) {
  const lane = openCodeLane(baseUrl);
  if (!lane) return;
  const wire = openCodeWire(body.model, lane);
  if (wire === "messages") return;
  if (suffix !== "/messages") unsupported("token counting on a translated model");
  const chat = toChat(body), outgoing = wire === "responses" ? toResponses(chat) : wire === "gemini" ? toGemini(chat, state) : chat;
  const path = wire === "responses" ? "/responses" : wire === "gemini" ? `/models/${encodeURIComponent(body.model)}:${body.stream ? "streamGenerateContent?alt=sse" : "generateContent"}` : "/chat/completions";
  const auth = credential ? wire === "gemini" ? {"x-goog-api-key": credential} : {authorization: `Bearer ${credential}`} : {};
  return {path, body: outgoing, auth, async response(response: Response): Promise<Response> {
    if (!response.ok || !response.body) return response;
    if (body.stream) {
      if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new Fault(502, "invalid_provider_response", "Provider did not return an event stream.");
      return fromStream(response, wire, body.model, state);
    }
    return Response.json(fromJson(await boundedJson(response), wire, body.model, state));
  }};
}
