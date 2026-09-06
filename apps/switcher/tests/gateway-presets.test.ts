import {expect, test} from "bun:test";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {prepareHarnessLaunch} from "../src/harnesses";
import {discover} from "../src/catalog";
import {getProviderPreset, providerCredential, providerFromPreset} from "../src/presets";

const operatorPresets = ["vllm", "litellm"] as const;

test("vLLM and LiteLLM presets require an explicit operator URL", () => {
  for (const id of operatorPresets) {
    const preset = getProviderPreset(id);
    expect(preset.protocols.map(route => route.protocol)).toEqual(["openai-chat", "openai-responses", "anthropic-messages"]);
    expect(preset.protocols.every(route => route.baseUrl === undefined)).toBe(true);
    expect(preset.credentialAliases).toEqual([]);
    expect(preset.credentialEnv).toBeUndefined();
    expect(preset.sources.length).toBeGreaterThan(0);
    expect(() => providerFromPreset(id)).toThrow("explicit --url");
    for (const route of preset.protocols) {
      const provider = providerFromPreset(id, {
        protocol: route.protocol,
        baseUrl: "https://operator.example/tenant/v1",
      });
      const suffix = route.protocol === "anthropic-messages" ? "messages"
        : route.protocol === "openai-responses" ? "responses" : "chat/completions";
      expect(new URL(`${provider.baseUrl}/${suffix}`).pathname).toBe(`/tenant/v1/${suffix}`);
    }
  }
});

test("operator gateway catalogs honor deployment prefixes, independent catalog auth, and exact model IDs", async () => {
  const requests: {path: string; authorization: string | null}[] = [];
  const upstream = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    requests.push({path: url.pathname, authorization: request.headers.get("authorization")});
    if (url.pathname !== "/catalog/v1/models") return new Response("Not found", {status: 404});
    return Response.json({data: [
      {id: "operator/Model-A", owned_by: "operator"},
      {id: "operator/Model-B", context_length: 32768},
    ], has_more: false});
  }});
  try {
    for (const id of operatorPresets) {
      const provider = {
        ...providerFromPreset(id, {
          protocol: "openai-chat",
          baseUrl: `${upstream.url.origin}/deployment/v1`,
          credentialEnv: "SWITCHER_PROVIDER_GATEWAY",
          catalogBaseUrl: `${upstream.url.origin}/catalog/v1`,
          catalogCredentialEnv: "SWITCHER_PROVIDER_CATALOG",
        }),
        version: 1,
        updatedAt: "now",
      };
      expect(provider.baseUrl).toBe(`${upstream.url.origin}/deployment/v1`);
      expect(provider.catalogBaseUrl).toBe(`${upstream.url.origin}/catalog/v1`);
      expect(providerCredential(provider, {
        SWITCHER_PROVIDER_GATEWAY: "inference-fixture",
        SWITCHER_PROVIDER_CATALOG: "catalog-fixture",
      })).toBe("inference-fixture");
      const catalog = await discover(provider, {
        SWITCHER_PROVIDER_GATEWAY: "inference-fixture",
        SWITCHER_PROVIDER_CATALOG: "catalog-fixture",
      });
      expect(catalog.models.map(model => model.id)).toEqual(["operator/Model-A", "operator/Model-B"]);
      expect(catalog.models[1].contextWindow).toBe(32768);
    }
    expect(requests).toEqual([
      {path: "/catalog/v1/models", authorization: "Bearer catalog-fixture"},
      {path: "/catalog/v1/models", authorization: "Bearer catalog-fixture"},
    ]);
  } finally {
    await upstream.stop(true);
  }
});

test("an explicit prefixed operator URL uses its own /models endpoint when no catalog override is supplied", async () => {
  const requests: {path: string; authorization: string | null}[] = [];
  const upstream = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    requests.push({path: url.pathname, authorization: request.headers.get("authorization")});
    return Response.json({data: [{id: "local/operator-model"}], has_more: false});
  }});
  try {
    for (const id of operatorPresets) {
      const provider = {
        ...providerFromPreset(id, {
          protocol: "openai-responses",
          baseUrl: `${upstream.url.origin}/tenant/openai/v1`,
          credentialEnv: "SWITCHER_PROVIDER_OPERATOR",
        }),
        version: 1,
        updatedAt: "now",
      };
      // An explicit --url clears any built-in catalog origin; discovery stays on
      // the operator's exact deployment prefix and never falls back elsewhere.
      expect(provider.catalogBaseUrl).toBeUndefined();
      expect(provider.modelsPath).toBe("models");
      expect((await discover(provider, {SWITCHER_PROVIDER_OPERATOR: "operator-fixture"})).models[0].id)
        .toBe("local/operator-model");
    }
    expect(requests).toEqual([
      {path: "/tenant/openai/v1/models", authorization: "Bearer operator-fixture"},
      {path: "/tenant/openai/v1/models", authorization: "Bearer operator-fixture"},
    ]);
  } finally {
    await upstream.stop(true);
  }
});

test("Messages catalog and bridge POST preserve the complete operator inference prefix", async () => {
  const requests: {path: string; authorization: string | null; version: string | null; model?: string}[] = [];
  const scratch=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace/scratch/switcher-tests");await mkdir(scratch,{recursive:true});
  const dir=await mkdtemp(join(scratch,"gateway-messages-"));
  const upstream = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url),body=request.method==="POST"?await request.json():undefined;
    requests.push({path:url.pathname,authorization:request.headers.get("authorization"),version:request.headers.get("anthropic-version"),...(body?{model:body.model}:{})});
    return body?Response.json({type:"message",content:[{type:"text",text:"fixture-success"}]}):Response.json({data:[{id:"messages/operator-model"}],has_more:false});
  }});
  try {
    for (const id of operatorPresets) {
      const provider={...providerFromPreset(id,{protocol:"anthropic-messages",baseUrl:`${upstream.url.origin}/deployment/v1`,credentialEnv:"SWITCHER_PROVIDER_MESSAGES"}),version:1,updatedAt:"now"};
      const catalog=await discover(provider,{SWITCHER_PROVIDER_MESSAGES:"messages-fixture"});
      const prepared=await prepareHarnessLaunch({harness:"grok",baseUrl:provider.baseUrl,protocol:provider.protocol,credential:"messages-fixture",authStyle:"bearer",model:catalog.models[0].id,models:catalog.models,stateDir:join(dir,id),cwd:dir,version:"grok 1.0.13"});
      try {
        const response=await fetch(prepared.env.GROK_MODELS_BASE_URL+"/messages",{method:"POST",headers:{authorization:`Bearer ${prepared.env.XAI_API_KEY}`,"content-type":"application/json","anthropic-version":"2023-06-01"},body:JSON.stringify({model:"messages/operator-model",messages:[{role:"user",content:"fixture prompt"}],max_tokens:8})});
        expect(response.status).toBe(200);expect((await response.json()).content[0].text).toBe("fixture-success");
      } finally {await prepared.cleanup?.();}
    }
    expect(requests).toEqual(operatorPresets.flatMap(()=>[
      {path:"/deployment/v1/models",authorization:"Bearer messages-fixture",version:"2023-06-01"},
      {path:"/deployment/v1/messages",authorization:"Bearer messages-fixture",version:"2023-06-01",model:"messages/operator-model"},
    ]));
  } finally {await upstream.stop(true);await rm(dir,{recursive:true,force:true});}
});

test("generic compatible presets keep their declared protocol with an independent prefixed catalog", async () => {
  const requests: {path: string; authorization: string | null}[] = [];
  const upstream = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    requests.push({path: url.pathname, authorization: request.headers.get("authorization")});
    return Response.json({data: [{id: "gateway/model"}], has_more: false});
  }});
  try {
    for (const [id, protocol] of [
      ["generic-openai-chat", "openai-chat"],
      ["generic-openai-responses", "openai-responses"],
    ] as const) {
      const provider = {
        ...providerFromPreset(id, {
          baseUrl: `${upstream.url.origin}/inference/v1`,
          catalogBaseUrl: `${upstream.url.origin}/catalog/v1`,
          credentialEnv: "SWITCHER_PROVIDER_GENERIC",
          catalogCredentialEnv: "SWITCHER_PROVIDER_GENERIC_CATALOG",
        }),
        version: 1,
        updatedAt: "now",
      };
      expect(provider.protocol).toBe(protocol);
      expect((await discover(provider, {
        SWITCHER_PROVIDER_GENERIC: "inference-fixture",
        SWITCHER_PROVIDER_GENERIC_CATALOG: "catalog-fixture",
      })).models[0].id).toBe("gateway/model");
    }
    expect(requests).toEqual([
      {path: "/catalog/v1/models", authorization: "Bearer catalog-fixture"},
      {path: "/catalog/v1/models", authorization: "Bearer catalog-fixture"},
    ]);
  } finally {
    await upstream.stop(true);
  }
});
