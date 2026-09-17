import {test,expect,spyOn} from "bun:test";
import {discover} from "../src/catalog";
import {codingEligible} from "../src/domain";
import {providerFromPreset,providerCredential} from "../src/presets";
import {verifyProviderAuthentication} from "../src/provider-credential-onboarding";

test("Bedrock Messages requires an explicit regional Mantle authority and uses its authenticated catalog",()=>{
 expect(()=>providerFromPreset("bedrock",{harness:"claude"})).toThrow("explicit --url");
 for(const baseUrl of ["https://example.com/anthropic/v1","https://bedrock-mantle.us-east-1.api.aws/other","http://127.0.0.1/anthropic/v1"])
  expect(()=>providerFromPreset("bedrock",{harness:"claude",baseUrl})).toThrow("Bedrock");
 const provider=providerFromPreset("bedrock",{harness:"claude",baseUrl:"https://bedrock-mantle.us-east-1.api.aws/anthropic/v1"});
 expect(provider.authStyle).toBe("x-api-key");expect(provider.catalogAuthStyle).toBe("bearer");expect(provider.catalogBaseUrl).toBe("https://bedrock-mantle.us-east-1.api.aws/v1");
 expect(providerCredential(provider,{AWS_BEARER_TOKEN_BEDROCK:"fixture"})).toBe("fixture");
 expect(providerCredential({...provider,baseUrl:"https://example.com/anthropic/v1"},{AWS_BEARER_TOKEN_BEDROCK:"fixture"})).toBeUndefined();
});
test("Bedrock onboarding authenticates without inference or cross-origin credential delivery",async()=>{
 const provider=providerFromPreset("bedrock",{harness:"claude",baseUrl:"https://bedrock-mantle.eu-west-1.api.aws/anthropic/v1"});let calls=0;
 const fetcher=(async(url:any,init:any)=>{calls++;expect(String(url)).toBe("https://bedrock-mantle.eu-west-1.api.aws/v1/models");expect(init.method).toBe("GET");expect(init.redirect).toBe("manual");expect(init.headers.authorization).toBe("Bearer fixture");return Response.json({data:[]});}) as typeof fetch;
 expect(await verifyProviderAuthentication({provider,credential:"fixture",fetch:fetcher})).toMatchObject({authenticated:true,status:200});expect(calls).toBe(1);
 expect(await verifyProviderAuthentication({provider:{...provider,baseUrl:"https://example.com/anthropic/v1"},credential:"fixture",fetch:fetcher})).toMatchObject({unsupported:true});expect(calls).toBe(1);
});
test("Gemini native and OpenAI-compatible presets have distinct identities and native credential preflight",async()=>{
 const native=providerFromPreset("gemini",{harness:"antigravity"}),chat=providerFromPreset("gemini",{harness:"junie",protocol:"openai-chat"});
 expect(native.id).not.toBe(chat.id);
 const fetcher=(async(url:any,init:any)=>{expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models");expect(init.headers["x-goog-api-key"]).toBe("fixture");return Response.json({models:[]});}) as typeof fetch;
 expect(await verifyProviderAuthentication({provider:native,credential:"fixture",fetch:fetcher})).toMatchObject({authenticated:true});
});
test("Bedrock's mixed catalog does not advertise other families for the Anthropic Messages route",async()=>{
 const provider={...providerFromPreset("bedrock",{harness:"claude",baseUrl:"https://bedrock-mantle.us-east-1.api.aws/anthropic/v1"}),version:1,updatedAt:new Date().toISOString()};
 const mock=spyOn(globalThis,"fetch").mockResolvedValue(Response.json({data:[{id:"anthropic.claude-sonnet-5"},{id:"openai.gpt-5.6-sol"}]}));
 try{const catalog=await discover(provider,{SWITCHER_PROVIDER_BEDROCK:"fixture"});expect(catalog.models).toHaveLength(2);expect(catalog.models.filter(codingEligible).map(m=>m.id)).toEqual(["anthropic.claude-sonnet-5"]);}finally{mock.mockRestore();}
});
