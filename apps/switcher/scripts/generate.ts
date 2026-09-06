import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import openapiTS, { astToString } from "openapi-typescript";
import { providerInputSchema, providerPresetSchema, profileInputSchema, modelSchema, runInputSchema, runUpdateSchema, idSchema, VERSION } from "../src/domain";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const meta = {version: z.number().int().positive(), updatedAt: z.string()};
const provider = providerInputSchema.innerType().required({authStyle: true, modelsPath: true, manualModels: true}).extend(meta);
const profile = profileInputSchema.extend(meta);
const catalog = z.object({models: z.array(modelSchema), refreshedAt: z.string(), source: z.enum(["remote", "manual"])});
const run = runInputSchema.extend({...meta, providerId:idSchema,providerVersion:z.number().int().positive(),profileVersion:z.number().int().positive(), id: idSchema, status: z.enum(["running","exited","failed","interrupted"]), startedAt: z.string(), endedAt: z.string().optional(), exitCode: z.number().int().optional()});
const definitions = {
  ProviderPreset: providerPresetSchema, ProviderInput: providerInputSchema, Provider: provider, ProfileInput: profileInputSchema, Profile: profile,
  Model: modelSchema, ModelPage:z.object({data:z.array(modelSchema.extend({codingEligible:z.boolean()})),total:z.number().int(),limit:z.number().int(),offset:z.number().int(),refreshedAt:z.string(),source:z.enum(["remote","manual"])}),Catalog: catalog, LaunchPlan: z.object({provider, profile, catalog, planToken:z.string(),warnings: z.array(z.string())}),
  RunInput: runInputSchema, RunUpdate: runUpdateSchema, Run: run,
  Health: z.object({status:z.enum(["ok","degraded","unavailable"]),version:z.string(),backend:z.enum(["sqlite","postgresql"])}), Ready:z.object({ready:z.boolean(),reason:z.string().optional()}), Version:z.object({version:z.string()}),
  LaunchInput: z.object({profileId: idSchema}), Empty: z.object({}).strict(),
  Error: z.object({error: z.object({code: z.string(), message: z.string(), requestId: z.string()})}),
};
const schemas = Object.fromEntries(Object.entries(definitions).map(([name, schema]) => [name, zodToJsonSchema(schema, {$refStrategy: "none", target: "openApi3"})]));
const ref = (name: string) => ({$ref: `#/components/schemas/${name}`});
const page = (name: string) => ({type: "object", required: ["data","total","limit","offset"], properties: {data: {type: "array", items: ref(name)}, total: {type: "integer"}, limit: {type: "integer"}, offset: {type: "integer"}}});
const paths: Record<string, any> = {};
function op(path: string, method: string, operationId: string, output: any, input?: string, list = false) {
  const parameters: any[] = [];
  if (path.includes("{id}")) parameters.push({name:"id", in:"path", required:true, schema:{type:"string"}});
  if (list) for (const [name, schema] of Object.entries({limit:{type:"integer",minimum:1,maximum:1000,default:100},offset:{type:"integer",minimum:0,default:0},search:{type:"string"}})) parameters.push({name,in:"query",schema});
  if (method !== "get") parameters.push({name:"Idempotency-Key",in:"header",required:true,schema:{type:"string",minLength:8,maxLength:128}});
  if (["put","patch","delete"].includes(method)) parameters.push({name:"If-Match",in:"header",required:true,schema:{type:"integer",minimum:1}});
  const status = method === "post" && ["/v1/providers","/v1/profiles","/v1/runs"].includes(path) ? "201" : "200";
  (paths[path] ??= {})[method] = {operationId, parameters,
    ...(input ? {requestBody:{required:true,content:{"application/json":{schema:ref(input)}}}} : {}),
    responses: {[status]:{description:"Success",content:{"application/json":{schema:output}}}, default:{description:"Structured error",content:{"application/json":{schema:ref("Error")}}}},
  };
}
for (const [plural, singular] of [["providers","Provider"],["profiles","Profile"]]) {
  op(`/v1/${plural}`,"get",`list${singular}s`,page(singular),undefined,true);
  op(`/v1/${plural}`,"post",`create${singular}`,ref(singular),`${singular}Input`);
  op(`/v1/${plural}/{id}`,"get",`get${singular}`,ref(singular));
  op(`/v1/${plural}/{id}`,"put",`update${singular}`,ref(singular),`${singular}Input`);
  op(`/v1/${plural}/{id}`,"delete",`delete${singular}`,{type:"object",properties:{deleted:{type:"string"}},required:["deleted"]});
}
op("/v1/provider-presets","get","listProviderPresets",{type:"object",required:["data"],properties:{data:{type:"array",items:ref("ProviderPreset")}}});
op("/v1/provider-presets/{id}","get","getProviderPreset",ref("ProviderPreset"));
op("/v1/providers/{id}/models","get","listModels",ref("ModelPage"),undefined,true);
op("/v1/providers/{id}/refresh","post","refreshModels",ref("Catalog"),"Empty");
op("/v1/launch-plans","post","launchPlan",ref("LaunchPlan"),"LaunchInput");
op("/v1/runs","get","listRuns",page("Run"),undefined,true);
op("/v1/runs/{id}","get","getRun",ref("Run"));
op("/v1/runs","post","createRun",ref("Run"),"RunInput");
op("/v1/runs/{id}","patch","finishRun",ref("Run"),"RunUpdate");
for (const path of ["/health","/ready","/version"]) {
  op(path,"get",path.slice(1),ref(path==="/health"?"Health":path==="/ready"?"Ready":"Version")); paths[path].get.security = [];
}
op("/v1/openapi.json","get","openApi",{type:"object",additionalProperties:true});
const document: any = {openapi:"3.0.3",info:{title:"Switcher API",version:VERSION,description:"Authenticated provider/profile/catalog control plane. Launches run locally; the API never returns provider credentials."},security:[{bearerAuth:[]}],paths,components:{securitySchemes:{bearerAuth:{type:"http",scheme:"bearer"}},schemas}};
const spec = JSON.stringify(document,null,2)+"\n";
const types = "// Generated from openapi.json. Run bun run generate.\n"+astToString(await openapiTS(document));
await mkdir(new URL("../src/generated/",import.meta.url),{recursive:true});
for (const [path, content] of [["../openapi.json",spec],["../src/generated/api.ts",types]]) {
  const url = new URL(path,import.meta.url);
  if (process.argv.includes("--check")) {
    if (await readFile(url,"utf8") !== content) throw new Error(`Generated file drift: ${path}`);
  } else await writeFile(url,content);
}
