import { expect, test } from "bun:test";
import { compileModelPolicy } from "../src/model-policy";
import { createInferenceGateway } from "../src/inference-gateway";

const models = [
  { id: "main", name: "Main", supportedParameters: ["tools"] },
  { id: "fallback", name: "Fallback", supportedParameters: ["tools"] },
  { id: "catalog-only", name: "Catalog only", supportedParameters: ["tools"] },
] as any;
const credential = "provider-secret-fixture";
const input = (protocol: any, baseUrl: string, events: any[]) => {
  const compiledPolicy = compileModelPolicy("main", models, { version: 1, aliases: { quick: "main" }, allowedModels: ["fallback"], fallbacks: { main: ["fallback"] } });
  return { harness: protocol === "gemini-generate-content" ? "gemini" : "pi", protocol, authStyle: protocol === "gemini-generate-content" ? "x-api-key" : "bearer", baseUrl, providerId: "fixture-provider", model: "main", models, credential, stateDir: "/Users/hasna/Workspace/scratch/universal-harness-switcher/model-routing-test-state", cwd: "/Users/hasna/Workspace/scratch/universal-harness-switcher", compiledPolicy, catalogPath: "/Users/hasna/Workspace/scratch/universal-harness-switcher/model-routing-test-catalog.json", onRoutingEvent: (event: any) => events.push(event) };
};
const auth = (protocol: string, token: string) => protocol === "gemini-generate-content" ? { "x-goog-api-key": token } : { authorization: `Bearer ${token}` };

test("gateway handles all four protocols, preserves native request content, and injects guidance once", async () => {
  const seen: any[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const body = await request.json(); seen.push({ path: new URL(request.url).pathname, body }); return Response.json({ model: body.model ?? body.generateContentRequest?.model?.replace(/^models\//, "") ?? "main", ok: true }); } });
  const protocols = ["anthropic-messages", "openai-chat", "openai-responses", "gemini-generate-content"] as const;
  try {
    for (const protocol of protocols) {
      const events: any[] = [];
      const gateway = createInferenceGateway(input(protocol, upstream.url.origin + "/prefix/v1", events) as any);
      try {
        const body = protocol === "anthropic-messages" ? { model: "main", system: "native", messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "base64", data: "x" } }] }] } : protocol === "openai-chat" ? { model: "main", messages: [{ role: "developer", content: "native" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "audio", input_audio: { data: "x" } }] }] } : protocol === "openai-responses" ? { model: "main", instructions: "native", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "data:image/png;base64,x" }] }] } : { model: "main", contents: [{ role: "user", parts: [{ text: "hello" }] }], systemInstruction: { parts: [{ text: "native" }] } };
        const response = await fetch(gateway.baseUrl + (protocol === "gemini-generate-content" ? "/models/main:generateContent" : protocol === "anthropic-messages" ? "/messages" : protocol === "openai-responses" ? "/responses" : "/chat/completions"), { method: "POST", headers: { ...auth(protocol, gateway.token), "content-type": "application/json" }, body: JSON.stringify(body) });
        expect(response.status).toBe(200);
        await response.text();
        const outgoing = seen.at(-1).body;
        expect(JSON.stringify(outgoing)).toContain("Switcher model policy");
        expect(JSON.stringify(outgoing)).toContain("native");
        expect(events.some(e => e.decision === "allow")).toBe(true);
        const auxiliaryPath = protocol === "gemini-generate-content" ? "/models/main:countTokens" : protocol === "anthropic-messages" ? "/messages/count_tokens" : protocol === "openai-responses" ? "/responses/compact" : "/chat/completions";
        const auxiliaryBody = protocol === "gemini-generate-content" ? { model: "main", generateContentRequest: { model: "main", contents: [] } } : protocol === "anthropic-messages" ? { model: "main", messages: [] } : protocol === "openai-responses" ? { model: "main", input: [] } : { model: "main", messages: [] };
        const auxiliary = await fetch(gateway.baseUrl + auxiliaryPath, { method: "POST", headers: { ...auth(protocol, gateway.token), "content-type": "application/json" }, body: JSON.stringify(auxiliaryBody) });
        expect(auxiliary.status).toBe(200); await auxiliary.text();
      } finally { await gateway.cleanup(); }
    }
    expect(seen).toHaveLength(8);
  } finally { await upstream.stop(true); }
});

test("gateway denies unknown and known-but-disallowed models before upstream", async () => {
  const seen: any[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const body = await request.json(); seen.push(body.model); return Response.json({ model: body.model }); } });
  const events: any[] = [], gateway = createInferenceGateway(input("openai-chat", upstream.url.origin + "/v1", events) as any);
  try {
    const request = (model: string) => fetch(gateway.baseUrl + "/chat/completions", { method: "POST", headers: { ...auth("openai-chat", gateway.token), "content-type": "application/json" }, body: JSON.stringify({ model, messages: [] }) });
    const alias = await request("quick"); await alias.text(); expect(alias.status).toBe(200);
    expect((await request("unknown")).status).toBe(403); expect((await request("catalog-only")).status).toBe(403); expect(seen).toEqual(["main"]);
  } finally { await gateway.cleanup(); await upstream.stop(true); }
});

for (const transient of [429, 500]) test(`gateway retries explicit fallback on ${transient} only`, async () => {
  const seen: string[] = [], statuses = new Map<string, number[]>([["main", [transient]], ["fallback", [200]]]);
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const body = await request.json(); const model = body.model; seen.push(model); return Response.json({ model }, { status: statuses.get(model)!.shift()! }); } });
  const events: any[] = [], gateway = createInferenceGateway(input("openai-chat", upstream.url.origin + "/v1", events) as any);
  try { const response = await fetch(gateway.baseUrl + "/chat/completions", { method: "POST", headers: { ...auth("openai-chat", gateway.token), "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [] }) }); await response.text(); expect(response.status).toBe(200); expect(seen).toEqual(["main", "fallback"]); expect(events.some(e => e.decision === "fallback")).toBe(true); }
  finally { await gateway.cleanup(); await upstream.stop(true); }
});

test("gateway does not retry 400, 401, or 403 and redacts unknown reported models", async () => {
  const seen: any[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const body = await request.json(); seen.push(body); return Response.json({ model: "outside-secret-model" }, { status: Number(body.probe) }); } });
  const events: any[] = [], gateway = createInferenceGateway(input("openai-chat", upstream.url.origin + "/v1", events) as any);
  try {
    const headers = { ...auth("openai-chat", gateway.token), "content-type": "application/json" };
    for (const status of [400, 401, 403]) { const response = await fetch(gateway.baseUrl + "/chat/completions", { method: "POST", headers, body: JSON.stringify({ model: "main", probe: status, messages: [] }) }); await response.text(); expect(response.status).toBe(status); }
    expect(seen).toHaveLength(3); expect(events.filter(e => e.reportedModel === "<unrecognized>")).toHaveLength(0);
  } finally { await gateway.cleanup(); await upstream.stop(true); }
});

test("gateway does not retry after a stream has started and reports unknown provider models safely", async () => {
  let calls = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { calls++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {\"model\":\"outside-secret-model\"}\n\ndata: [DONE]\n\n")); controller.close(); } }), { headers: { "content-type": "text/event-stream" } }); } });
  const events: any[] = [], gateway = createInferenceGateway(input("openai-chat", upstream.url.origin + "/v1", events) as any);
  try { const response = await fetch(gateway.baseUrl + "/chat/completions", { method: "POST", headers: { ...auth("openai-chat", gateway.token), "content-type": "application/json" }, body: JSON.stringify({ model: "main", messages: [] }) }); await response.text(); expect(calls).toBe(1); expect(events.at(-1).reportedModel).toBe("<unrecognized>"); }
  finally { await gateway.cleanup(); await upstream.stop(true); }
});

test("gateway rejects top-level and nested routing keys and cleanup cancels an active stream", async () => {
  let cancelled = false;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {\"model\":\"main\"}\n\n")); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } }); } });
  const events: any[] = [], gateway = createInferenceGateway(input("gemini-generate-content", upstream.url.origin + "/v1", events) as any);
  try {
    const headers = { ...auth("gemini-generate-content", gateway.token), "content-type": "application/json" };
    expect((await fetch(gateway.baseUrl + "/models/main:generateContent", { method: "POST", headers, body: JSON.stringify({ model: "main", router: {} }) })).status).toBe(403);
    expect((await fetch(gateway.baseUrl + "/models/main:countTokens", { method: "POST", headers, body: JSON.stringify({ model: "main", generateContentRequest: { model: "main", extra_body: {} } }) })).status).toBe(403);
    const response = await fetch(gateway.baseUrl + "/models/main:streamGenerateContent", { method: "POST", headers, body: JSON.stringify({ model: "main", contents: [] }) });
    await response.body?.cancel(); await gateway.cleanup(); await new Promise(resolve => setTimeout(resolve, 20)); expect(cancelled).toBe(true);
  } finally { await gateway.cleanup(); await upstream.stop(true); }
});


test("gateway preserves Claude Messages beta query and rejects other query routing",async()=>{
 const seen:string[]=[];const events:any[]=[];
 const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){seen.push(new URL(req.url).search);return Response.json({model:"main"});}});
 const gateway=createInferenceGateway(input("anthropic-messages",upstream.url.origin+"/v1",events) as any);
 try{
  for(const [query,status] of [["?beta=true",200],["?beta=false",400],["?beta=true&model=other",400],["?beta=true&beta=true",400]] as const){const response=await fetch(gateway.baseUrl+"/messages"+query,{method:"POST",headers:{authorization:`Bearer ${gateway.token}`,"content-type":"application/json"},body:JSON.stringify({model:"main",messages:[]})});expect(response.status).toBe(status);await response.text();}
  expect(seen).toEqual(["?beta=true"]);
 }finally{await gateway.cleanup();await upstream.stop(true);}
});
