import { describe, expect, test } from "bun:test";
import { compileModelPolicy, injectModelGuidance, renderModelGuidance, resolvePolicyModel } from "../src/model-policy";

const catalog = [
  { id: "main", name: "Main", supportedParameters: ["tools"] },
  { id: "fast", name: "Fast", supportedParameters: ["tools"] },
  { id: "review", name: "Review", supportedParameters: ["tools"] },
  { id: "fallback", name: "Fallback", supportedParameters: ["tools"] },
] as any;
const policy = { version: 1 as const, roles: { fast: "fast", review: "review" }, allowedModels: ["fallback"], aliases: { quick: "fast" }, fallbacks: { main: ["fallback"] } };

describe("model policy", () => {
  test("compiles roles, union allowlist, aliases and fallbacks deterministically", () => {
    const result = compileModelPolicy("main", catalog, policy);
    expect(result.roles.fast).toBe("fast");
    expect(result.roles.subagent).toBe("main");
    expect(result.allowedModels).toEqual(["fallback", "fast", "main", "review"]);
    expect(resolvePolicyModel(result, "quick")).toBe("fast");
    expect(result.digest).toHaveLength(64);
    expect(compileModelPolicy("main", catalog, policy).digest).toBe(result.digest);
  });
  test("rejects unknown, shadowing, self-fallback and malformed inputs without echoing values", () => {
    expect(() => compileModelPolicy("main", catalog, { roles: { fast: "missing" } })).toThrow("not present");
    expect(() => compileModelPolicy("main", catalog, { aliases: { main: "fast" } })).toThrow("shadow");
    expect(() => compileModelPolicy("main", catalog, { fallbacks: { main: ["main"] } })).toThrow("itself");
    expect(() => resolvePolicyModel(compileModelPolicy("main", catalog), "outside\nsecret")).toThrow("invalid");
  });
  test("guidance is bounded to role data and safe endpoint origin", () => {
    const compiled = compileModelPolicy("main", catalog, policy);
    const text = renderModelGuidance({ harness: "pi", providerId: "provider", baseUrl: "https://gateway.example/v1?secret=omit", model: "main", compiled, catalogPath: "/private/catalog.json" });
    expect(text).toContain("https://gateway.example");
    expect(text).not.toContain("secret=omit");
    expect(text).not.toContain("Full catalog entries");
    expect(text).toContain("Allowed models"); expect(text.length).toBeLessThan(12000);
  });
  test("preserves inputs and injects exactly once across all protocols", () => {
    const guidance = "[Switcher model policy]\nCurrent request model: main";
    const messages = [{ role: "system", content: "Keep this" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "data:image/png;base64,x" } }] }];
    const original = structuredClone(messages);
    const chat = injectModelGuidance("openai-chat", { model: "main", messages }, guidance) as any;
    expect(messages).toEqual(original); expect(chat.messages[0].content).toContain("Keep this"); expect(chat.messages[0].content.match(/\[Switcher model policy\]/g)).toHaveLength(1);
    const anthropic = injectModelGuidance("anthropic-messages", { model: "main", messages, system: "Base system" }, guidance) as any;
    expect(anthropic.system).toContain("Base system"); expect(anthropic.messages).toEqual(messages);
    const responses = injectModelGuidance("openai-responses", { input: [{ role: "user", content: "x" }], instructions: null }, guidance) as any;
    expect(responses.instructions).toContain("Current request model"); expect(responses.input).toEqual([{ role: "user", content: "x" }]);
    const gemini = injectModelGuidance("gemini-generate-content", { contents: [{ role: "user", parts: [{ text: "x" }] }], systemInstruction: { parts: [{ text: "base" }] } }, guidance) as any;
    expect(gemini.contents[0].parts[0].text).toBe("x"); expect(gemini.systemInstruction.parts.at(-1).text).toContain("Current request model");
    const count = injectModelGuidance("gemini-generate-content", { generateContentRequest: { contents: [], systemInstruction: { parts: [] } } }, guidance, "countTokens") as any;
    expect(count.generateContentRequest.systemInstruction.parts).toHaveLength(1);
  });
});

test("replay replaces stale policy blocks and preserves adjacent native text and cache metadata",()=>{
  const compiled=compileModelPolicy("main",catalog);
  const first=renderModelGuidance({harness:"claude",model:"main",compiled});
  const next=renderModelGuidance({harness:"claude",model:"fast",compiled});
  const original={system:[{type:"text",text:`Native before\n${first}\nNative after`,cache_control:{type:"ephemeral"}}],messages:[]};
  const once=injectModelGuidance("anthropic-messages",original,next) as any;
  const twice=injectModelGuidance("anthropic-messages",once,next);
  expect(twice).toEqual(once);
  expect(once.system[0]).toEqual({type:"text",text:"Native before\n\nNative after",cache_control:{type:"ephemeral"}});
  expect(JSON.stringify(once).match(/Switcher model policy/g)).toHaveLength(1);
  expect(JSON.stringify(once)).toContain('Current request model: \\"fast\\"');
  expect(original.system[0].text).toContain(first);
});

test("guidance preserves exact long model IDs and bounds large policy catalogs without cutting IDs",()=>{
  const long="vendor/"+"a".repeat(290),models=[{id:long,name:"Long"},...Array.from({length:500},(_,i)=>({id:`vendor/${i}-`+"b".repeat(270),name:"Model"}))];
  const compiled=compileModelPolicy(long,models,{allowedModels:models.slice(1).map(m=>m.id)});
  const text=renderModelGuidance({harness:"claude",model:long,compiled,catalogPath:"/owned/catalog.json"});
  expect(text).toContain(JSON.stringify(long));expect(text.length).toBeLessThan(12000);
  expect(text).toContain("policy.allowedModels");
});


test("Chat replay removes owned blocks across multiple instruction messages and preserves user text",()=>{
 const policy=compileModelPolicy("main",[{id:"main",name:"Main"}] as any);
 const guidance=renderModelGuidance({harness:"grok",model:"main",compiled:policy});
 const input={messages:[{role:"system",content:"First native instruction"},{role:"developer",content:"Second native instruction\n"+guidance},{role:"user",content:guidance}]};
 const once=injectModelGuidance("openai-chat",input,guidance) as any;
 expect(once.messages[1].content).toBe("Second native instruction");
 expect(once.messages[2]).toEqual(input.messages[2]);
 expect(injectModelGuidance("openai-chat",once,guidance)).toEqual(once);
 expect(()=>injectModelGuidance("openai-responses",{instructions:{}},guidance)).toThrow("instructions");
});
