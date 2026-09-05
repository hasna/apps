#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { clientFromEnv, SwitcherError } from "./sdk";
import { VERSION, parse, providerInputSchema, profileInputSchema } from "./domain";
import { detectHarness } from "./harnesses";
import { launch } from "./launcher";
const HELP = `switcher — launch a coding harness with a provider and its model catalog

  switcher providers list [--search TEXT] [--limit N] [--offset N]
  switcher providers add ID --url URL --protocol PROTOCOL [--credential-env NAME]
  switcher providers add ID --preset openrouter --protocol PROTOCOL
  switcher providers get|refresh ID
  switcher providers update ID --file provider.json --version N
  switcher providers delete ID --version N
  switcher models PROVIDER [--refresh] [--search TEXT] [--limit N]
  switcher profiles list|get [ID]
  switcher profiles add ID --provider ID --harness HARNESS --model MODEL
  switcher profiles update ID --file profile.json --version N
  switcher profiles delete ID --version N
  switcher launch PROFILE [--cwd DIR] [--executable PATH] [--state-dir DIR]
                          [--timeout SECONDS] -- [native harness arguments]
  switcher runs list|get [ID]
  switcher doctor

HARNESS: claude, codex, grok, opencode2
PROTOCOL: anthropic-messages, openai-responses, openai-chat
All data commands require HASNA_SWITCHER_API_URL + HASNA_SWITCHER_API_KEY.
Provider credential references must start SWITCHER_PROVIDER_.
--file accepts a JSON object including id; raw credentials are never accepted.
--json outputs machine-readable records (also the default for data commands).
switcher --version | --help
`;
async function readInput(path: string): Promise<unknown> {
  try { return await Bun.file(path).json(); } catch { throw new Error("Input file must be readable, valid JSON."); }
}
export async function main(args = process.argv.slice(2)) {
  const split = args.indexOf("--"); const nativeArgs = split >= 0 ? args.slice(split+1) : [];
  const {values,positionals} = parseArgs({args:split>=0?args.slice(0,split):args,allowPositionals:true,options:{
    help:{type:"boolean"},version:{type:"string"},json:{type:"boolean"},url:{type:"string"},
    protocol:{type:"string"},preset:{type:"string"},name:{type:"string"},file:{type:"string"},
    "credential-env":{type:"string"},"auth-style":{type:"string"},provider:{type:"string"},
    harness:{type:"string"},model:{type:"string"},search:{type:"string"},limit:{type:"string"},offset:{type:"string"},
    refresh:{type:"boolean"},cwd:{type:"string"},executable:{type:"string"},"state-dir":{type:"string"},timeout:{type:"string"},
  }});
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command,action,id] = positionals;
  const output = (value: unknown) => console.log(JSON.stringify(value,null,2));
  if (command === "doctor") {
    const harnesses = await Promise.all((["claude","codex","grok","opencode2"] as const).map(h => detectHarness(h)));
    let api: unknown = {configured:false};
    if (process.env.HASNA_SWITCHER_API_URL) {
      try { await clientFromEnv().listProviders({limit:1}); api={configured:true,reachable:true}; } catch { api={configured:true,reachable:false}; }
    }
    output({version:VERSION,harnesses,api,liveVerified:false}); return;
  }
  const client = clientFromEnv();
  const page = {limit:values.limit?Number(values.limit):undefined,offset:values.offset?Number(values.offset):undefined,search:values.search};
  const currentVersion = () => { const n=Number(values.version); if(!Number.isSafeInteger(n)||n<1) throw new Error("Use --version N with the record's current version."); return n; };
  if (command === "launch") {
    if(!action) throw new Error("A profile ID is required.");
    const timeoutMs = values.timeout ? Number(values.timeout)*1000 : undefined;
    if(timeoutMs !== undefined && (!Number.isFinite(timeoutMs)||timeoutMs<=0)) throw new Error("--timeout must be positive seconds.");
    process.exitCode = await launch(client,action,{cwd:values.cwd,executable:values.executable,stateDir:values["state-dir"],args:nativeArgs,timeoutMs}); return;
  }
  if(command==="models" && action) { if(values.refresh) await client.refreshModels(action); output(await client.listModels(action,page)); return; }
  if(command==="runs") { output(action==="get"&&id?await client.getRun(id):action==="list"?await client.listRuns(page):(()=>{throw new Error("Use runs list|get ID.");})()); return; }
  if(command==="providers") {
    if(action==="list") {output(await client.listProviders(page));return;}
    if(action==="get"&&id) {output(await client.getProvider(id));return;}
    if(action==="refresh"&&id) {output(await client.refreshModels(id));return;}
    if(action==="delete"&&id) {output(await client.deleteProvider(id,currentVersion()));return;}
    if(["add","update"].includes(action)&&id) {
      if(values.preset && values.preset!=="openrouter") throw new Error("Supported preset: openrouter.");
      const input = parse(providerInputSchema,values.file?await readInput(values.file):{
        id,name:values.name??id,baseUrl:values.url??(values.preset==="openrouter"?"https://openrouter.ai/api/v1":undefined),
        protocol:values.protocol,credentialEnv:values["credential-env"],authStyle:values["auth-style"],
      });
      if(input.id!==id) throw new Error("File id must match the command id.");
      output(action==="add"?await client.createProvider(input):await client.updateProvider(input,currentVersion()));return;
    }
  }
  if(command==="profiles") {
    if(action==="list") {output(await client.listProfiles(page));return;}
    if(action==="get"&&id) {output(await client.getProfile(id));return;}
    if(action==="delete"&&id) {output(await client.deleteProfile(id,currentVersion()));return;}
    if(["add","update"].includes(action)&&id) {
      const input = parse(profileInputSchema,values.file?await readInput(values.file):{id,name:values.name??id,providerId:values.provider,harness:values.harness,model:values.model});
      if(input.id!==id) throw new Error("File id must match the command id.");
      output(action==="add"?await client.createProfile(input):await client.updateProfile(input,currentVersion()));return;
    }
  }
  throw new Error("Unknown command or missing arguments. Run switcher --help.");
}
if(import.meta.main) {
  if(process.argv.slice(2).length===1&&process.argv[2]==="--version") console.log(VERSION);
  else main().catch(error=>{console.error(JSON.stringify({error:error instanceof SwitcherError?{code:error.code,message:error.message,requestId:error.requestId}:{message:error instanceof Error?error.message:"Command failed."}}));process.exitCode=1;});
}
