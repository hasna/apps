import { expect, test } from "bun:test";
import { modelSchema, modelExpired, codingEligible, harnessEligible, parse, providerInputSchema } from "../src/domain";
import { compileModelPolicy } from "../src/model-policy";
import { discover } from "../src/catalog";
import { providerFromPreset } from "../src/presets";
import { resolveLaunchProvider } from "../src/direct-launch";
import { SwitcherError, type SwitcherClient } from "../src/sdk";

test("expiry dates are real calendar days, inclusive in UTC", () => {
  const model = {id:"preview",name:"Preview",expiresOn:"2026-09-10"};
  for (const day of ["2026-09-10", "2028-02-29"]) expect(modelSchema.safeParse({...model,expiresOn:day}).success).toBe(true);
  for (const day of ["2026-02-29", "2026-04-31", "2026-9-10", "2026-09-10T00:00:00Z", "", "next Tuesday"])
    expect(modelSchema.safeParse({...model,expiresOn:day}).success).toBe(false);
  expect(modelExpired(model,new Date("2026-09-09T23:59:59.999Z"))).toBe(false);
  expect(modelExpired(model,new Date("2026-09-10T23:59:59.999Z"))).toBe(false);
  expect(modelExpired(model,new Date("2026-09-11T00:00:00.000Z"))).toBe(true);
  expect(modelExpired({id:"stable",name:"Stable"},new Date("9999-01-01T00:00:00Z"))).toBe(false);
});

test("expired models cannot be selected, assigned a role, aliased, allowed or used as fallback", () => {
  const live = {id:"live",name:"Live"}, expired = {id:"expired",name:"Expired",expiresOn:"2000-01-01"};
  expect(codingEligible(expired)).toBe(false);
  for (const harness of ["claude","codex","aider"] as const) expect(harnessEligible(expired,harness)).toBe(false);
  for (const [model,policy] of [
    ["expired",{}], ["live",{roles:{subagent:"expired"}}], ["live",{allowedModels:["expired"]}],
    ["live",{aliases:{preview:"expired"}}], ["live",{fallbacks:{live:["expired"]}}],
  ] as const) {
    let error: unknown;
    try { compileModelPolicy(model,[live,expired],policy as any); } catch (caught) { error=caught; }
    expect(error).toMatchObject({status:422,code:"model_expired"});
  }
  expect(compileModelPolicy("live",[live,expired]).allowedModels).toEqual(["live"]);
});

test("additional expiring models preserve discovery and override remote metadata after count reconciliation", async () => {
  const upstream = Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({total_count:2,data:[
    {id:"stable",context_window:64000}, {id:"preview",context_window:100000,expiresOn:"9999-01-01"},
  ]})});
  try {
    const provider = {...parse(providerInputSchema,{id:"expiry",name:"Expiry",baseUrl:upstream.url.origin,protocol:"openai-chat",additionalModels:[
      {id:"preview",name:"Preview",expiresOn:"2000-01-01"}, {id:"unlisted",name:"Unlisted",expiresOn:"9999-12-31"},
    ]}),version:1,updatedAt:new Date().toISOString()};
    const catalog = await discover(provider);
    expect(catalog.source).toBe("remote");
    expect(catalog.models.map(model=>model.id)).toEqual(["stable","preview","unlisted"]);
    expect(catalog.models[1]).toMatchObject({contextWindow:100000,expiresOn:"2000-01-01"});
    expect(catalog.models[0].expiresOn).toBeUndefined();
    expect(modelExpired(catalog.models[1])).toBe(true);
    const raw = await discover({...provider,additionalModels:[]});
    expect(raw.models[1].expiresOn).toBe("9999-01-01");
  } finally { await upstream.stop(true); }
});

test("DeepSeek presets add the official Flash model without replacing the discovered catalog", () => {
  const provider = providerFromPreset("deepseek",{harness:"claude"});
  expect(provider.manualModels).toEqual([]);
  expect(provider.additionalModels).toEqual([{id:"deepseek-flash",name:"DeepSeek V4.1 Flash",inputModalities:["text","image"],outputModalities:["text"],supportedParameters:["tools"]}]);
  expect(providerFromPreset("deepseek",{baseUrl:"https://custom.example/v1",credentialEnv:"SWITCHER_PROVIDER_CUSTOM"}).additionalModels).toEqual([]);
});

test("preset aliases retain existing additive models without treating new model defaults as transport conflicts", async () => {
  const {additionalModels, ...legacy} = providerFromPreset("deepseek",{harness:"claude"});
  for (const additions of [undefined,[{id:"custom-preview",name:"Custom",expiresOn:"9999-01-01"}]]) {
    const saved={...legacy,...(additions?{additionalModels:additions}:{}),version:1,updatedAt:new Date().toISOString()};
    const client={getProvider:async(id:string)=>{if(id==="deepseek")throw new SwitcherError(404,"not_found","missing");return saved;}} as unknown as SwitcherClient;
    expect(await resolveLaunchProvider(client,"deepseek",{harness:"claude"})).toEqual(saved);
  }
});
