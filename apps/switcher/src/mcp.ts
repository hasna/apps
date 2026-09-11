#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clientFromEnv } from "./sdk";
import { VERSION, providerInputSchema, profileInputSchema, modelSchema } from "./domain";
const server = new McpServer({name:"switcher",version:VERSION});
const page = {limit:z.number().int().min(1).max(1000).optional(),offset:z.number().int().nonnegative().optional(),search:z.string().optional()};
function tool(name:string,description:string,schema:z.ZodRawShape,run:(input:any)=>Promise<unknown>) {
  server.tool(name,description,schema,async input=>{
    try { return {content:[{type:"text" as const,text:JSON.stringify(await run(input))}]}; }
    catch { return {isError:true,content:[{type:"text" as const,text:"Switcher API operation failed. Check configuration, input and API availability."}]}; }
  });
}
tool("providers_list","List provider profiles.",page,p=>clientFromEnv().listProviders(p));
tool("providers_get","Get a provider.",{id:z.string()},p=>clientFromEnv().getProvider(p.id));
tool("providers_create","Create a provider using credential environment references only.",providerInputSchema.innerType().shape,p=>clientFromEnv().createProvider(p));
tool("providers_update","Replace a provider at its current version.",{provider:providerInputSchema,version:z.number().int()},p=>clientFromEnv().updateProvider(p.provider,p.version));
tool("providers_delete","Delete an unreferenced provider.",{id:z.string(),version:z.number().int()},p=>clientFromEnv().deleteProvider(p.id,p.version));
tool("models_list","List catalog with capability information.",{id:z.string(),...page},p=>{const {id,...rest}=p;return clientFromEnv().listModels(id,rest);});
tool("models_add","Add saved model metadata; discovery stays active unless the provider uses a manual catalog.",{providerId:z.string(),model:modelSchema},p=>clientFromEnv().addModel(p.providerId,p.model));
tool("models_update","Replace all saved metadata for a configured model.",{providerId:z.string(),model:modelSchema},p=>clientFromEnv().updateModel(p.providerId,p.model));
tool("models_remove","Remove saved model metadata; upstream catalog entries remain.",{providerId:z.string(),modelId:modelSchema.shape.id},p=>clientFromEnv().removeModel(p.providerId,p.modelId));
tool("models_refresh","Discover provider models.",{id:z.string()},p=>clientFromEnv().refreshModels(p.id));
tool("profiles_list","List harness launch profiles.",page,p=>clientFromEnv().listProfiles(p));
tool("profiles_get","Get a harness profile.",{id:z.string()},p=>clientFromEnv().getProfile(p.id));
tool("profiles_create","Create a harness launch profile.",profileInputSchema.shape,p=>clientFromEnv().createProfile(p));
tool("profiles_update","Replace a harness profile at its version.",{profile:profileInputSchema,version:z.number().int()},p=>clientFromEnv().updateProfile(p.profile,p.version));
tool("profiles_delete","Delete a profile without run history.",{id:z.string(),version:z.number().int()},p=>clientFromEnv().deleteProfile(p.id,p.version));
tool("launch_plan","Validate a local launch plan; does not execute a remote process.",{profileId:z.string()},p=>clientFromEnv().launchPlan(p.profileId));
tool("runs_list","List launch metadata.",page,p=>clientFromEnv().listRuns(p));
tool("runs_get","Get launch metadata.",{id:z.string()},p=>clientFromEnv().getRun(p.id));
if(process.argv.includes("--version")) console.log(VERSION);
else if(process.argv.includes("--help")) console.log("switcher-mcp: authenticated Switcher API tools over MCP stdio. Resolves API URL/key through @hasna/contracts (Keychain, canonical config/credentials, or environment).");
else await server.connect(new StdioServerTransport());
