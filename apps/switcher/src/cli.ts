#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { SwitcherError } from "./sdk";
import { VERSION, Fault, CommandInterrupted, parse, harnessSchema, protocolSchema, providerInputSchema, profileInputSchema, compatible, codingEligible } from "./domain";
import { detectHarness } from "./harnesses";
import { launch, validateOriForPlan, type LaunchBackend } from "./launcher";
import { openCliRuntime } from "./runtime";
import { providerFromPreset, type PresetOptions } from "./presets";
import { resolveLaunchProvider, selectModel, ensureLaunchProfile } from "./direct-launch";
import { CredentialResolver, bindingTarget, credentialReference, credentialBindingSchema, deliverVaultCredential } from "./credentials";
const HELP = `switcher — launch a coding harness with a provider and its model catalog

  switcher providers presets [ID]
  switcher providers list [--search TEXT] [--limit N] [--offset N]
  switcher providers add ID --url URL --protocol PROTOCOL [--credential-env NAME]
  switcher providers add ID --preset PRESET [--protocol PROTOCOL] [--catalog-account-id ID]
  switcher providers get|refresh ID
  switcher providers update ID --file provider.json --version N
  switcher providers delete ID --version N
  switcher models PROVIDER [--refresh] [--search TEXT] [--limit N]
  switcher profiles list|get [ID]
  switcher profiles add ID --provider ID --harness HARNESS --model MODEL
  switcher profiles update ID --file profile.json --version N
  switcher profiles delete ID --version N
  switcher launch HARNESS --provider PROVIDER [--model MODEL] [--dry-run]
  switcher launch PROFILE [--backend direct|ori] [--cwd DIR] [--executable PATH]
                          [--ori-executable PATH] [--state-dir DIR]
                          [--timeout SECONDS] -- [native harness arguments]
  switcher runs list|get [ID]
  switcher credentials bind PRESET --vault-key KEY --vault-url URL
                            [--vault-cli PATH] [--vault-account ACCOUNT]
  switcher credentials bind PRESET --keychain-service SERVICE --keychain-account ACCOUNT
  switcher credentials list|check|remove [PRESET_OR_REFERENCE]
  switcher doctor

HARNESS: claude, codex, grok, opencode2, pi, cline
PROTOCOL: anthropic-messages, openai-responses, openai-chat
Without remote API configuration, the CLI owns a local authenticated API and
stores data in ~/.hasna/switcher (override HASNA_SWITCHER_HOME).
Set HASNA_SWITCHER_API_URL + HASNA_SWITCHER_API_KEY for a remote API.
A configured remote API never falls back to local data.
Provider credential references must start SWITCHER_PROVIDER_.
Credential bindings contain references only. Custom destinations require --origin URL.
Vault bindings use the installed secrets CLI; --vault-account reads its operator
from macOS Keychain, otherwise HASNA_SECRETS_API_KEY must be injected per process.
  --file accepts a JSON object including id; raw credentials are never accepted.
Fireworks discovery requires --catalog-account-id (or an explicit --catalog-url).
--json outputs machine-readable records (also the default for data commands).
switcher --version | --help
`;
async function readInput(path: string): Promise<unknown> {
  try { return await Bun.file(path).json(); } catch { throw new Error("Input file must be readable, valid JSON."); }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "__credential-delivery") return deliverVaultCredential();
  const split = args.indexOf("--"); const nativeArgs = split >= 0 ? args.slice(split+1) : [];
  const {values,positionals} = parseArgs({args:split>=0?args.slice(0,split):args,allowPositionals:true,options:{
    help:{type:"boolean"},version:{type:"string"},json:{type:"boolean"},url:{type:"string"},
    protocol:{type:"string"},preset:{type:"string"},name:{type:"string"},file:{type:"string"},
    "credential-env":{type:"string"},"auth-style":{type:"string"},
    "catalog-url":{type:"string"},"catalog-format":{type:"string"},"catalog-auth-style":{type:"string"},
    "catalog-credential-env":{type:"string"},"catalog-account-id":{type:"string"},"models-path":{type:"string"},"dry-run":{type:"boolean"},provider:{type:"string"},
    harness:{type:"string"},model:{type:"string"},search:{type:"string"},limit:{type:"string"},offset:{type:"string"},
    refresh:{type:"boolean"},backend:{type:"string"},cwd:{type:"string"},executable:{type:"string"},"ori-executable":{type:"string"},"state-dir":{type:"string"},timeout:{type:"string"},
    "vault-key":{type:"string"},"vault-url":{type:"string"},"vault-cli":{type:"string"},"vault-account":{type:"string"},
    "keychain-service":{type:"string"},"keychain-account":{type:"string"},origin:{type:"string",multiple:true},
  }});
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command,action,id] = positionals;
  const output = (value: unknown) => console.log(JSON.stringify(value,null,2));
  if (!["doctor", "launch", "models", "runs", "providers", "profiles", "credentials"].includes(command))
    throw new Error("Unknown command. Run switcher --help.");
  const providerFlags = ["url", "protocol", "preset", "credential-env", "auth-style", "catalog-url", "catalog-format", "catalog-auth-style", "catalog-credential-env", "catalog-account-id", "models-path"] as const;
  const provided = (names: readonly (keyof typeof values)[]) => names.some(name => values[name] !== undefined);
  const credentialFlags = ["vault-key","vault-url","vault-cli","vault-account","keychain-service","keychain-account","origin"] as const;
  const credentials = new CredentialResolver();
  if (command === "credentials") {
    const bindingFlags = [...credentialFlags,"credential-env"] as const;
    if (nativeArgs.length || positionals.length > 3 || Object.keys(values).some(name=>name!=="json" && !bindingFlags.includes(name as typeof bindingFlags[number])))
      throw new Fault(400,"conflicting_options","Credentials accepts only binding options; no API, profile or harness settings.");
    if (action !== "bind" && provided(bindingFlags)) throw new Fault(400,"conflicting_options","Credential source and origin options belong to credentials bind.");
    if (action === "list" && !id) { output(await credentials.bindings.list()); return; }
    if (action === "remove" && id) { output(await credentials.bindings.remove(credentialReference(id))); return; }
    if (action === "check" && id) { output(await credentials.check(credentialReference(id))); return; }
    if (action !== "bind" || !id) throw new Fault(400,"invalid_request","Use credentials bind PRESET, list, check PRESET_OR_REFERENCE, or remove PRESET_OR_REFERENCE.");
    const hasVault = provided(["vault-key","vault-url","vault-cli","vault-account"]);
    const hasKeychain = provided(["keychain-service","keychain-account"]);
    if (hasVault === hasKeychain) throw new Fault(400,"conflicting_options","Choose one credential source: vault or Keychain.");
    const source = hasVault ? {
      kind:"vault",key:values["vault-key"],url:values["vault-url"],executable:values["vault-cli"] ?? Bun.which("secrets"),
      operator:values["vault-account"] ? {kind:"keychain",account:values["vault-account"]} : {kind:"env"},
    } : {kind:"keychain",service:values["keychain-service"],account:values["keychain-account"]};
    output(await credentials.bindings.bind(parse(credentialBindingSchema,{schema:1,...bindingTarget(id,values["credential-env"],values.origin),source})));
    return;
  }
  if (provided(credentialFlags)) throw new Fault(400,"conflicting_options","Credential source and origin options belong to credentials bind.");
  const backend = values.backend ?? "direct";
  if (backend !== "direct" && backend !== "ori") throw new Fault(400, "invalid_backend", "Use --backend direct or --backend ori.");
  if (command !== "launch" && (values.backend !== undefined || values["ori-executable"] !== undefined))
    throw new Fault(400, "conflicting_options", "--backend and --ori-executable belong to launch.");
  if (command === "launch" && backend === "ori" && values.executable !== undefined)
    throw new Fault(400, "conflicting_options", "--executable is ambiguous with --backend ori; use --ori-executable PATH.");
  if (command === "launch" && backend === "direct" && values["ori-executable"] !== undefined)
    throw new Fault(400, "conflicting_options", "--ori-executable requires --backend ori.");
  const mutation = (command === "providers" || command === "profiles") && ["add", "update"].includes(action);
  if (values.file && (!mutation || provided([...providerFlags, "name", "provider", "harness", "model"])))
    throw new Fault(400, "conflicting_options", "Use --file by itself for provider/profile settings; inline settings cannot override an input file.");
  if (command === "launch" && !values.provider && provided([...providerFlags, "name", "harness", "model", "search"]))
    throw new Fault(400, "conflicting_options", "Use --provider PROVIDER for direct launch settings, or update the saved profile explicitly.");
  if (values.preset && !(command === "providers" && mutation))
    throw new Fault(400, "conflicting_options", "--preset belongs to providers add/update. For direct launches use --provider PRESET.");
  if (values.refresh && command !== "models")
    throw new Fault(400, "conflicting_options", "--refresh belongs to models. Launch always discovers a fresh catalog.");
  if (values["dry-run"] && command !== "launch")
    throw new Fault(400, "conflicting_options", "--dry-run belongs to launch.");
  if (command === "launch" && provided(["name", "harness", "file"]))
    throw new Fault(400, "conflicting_options", "Launch takes its harness from the positional argument or saved profile; edit named records through providers/profiles.");
  const runtime = await openCliRuntime(process.env,provider=>credentials.resolve(provider));
  const client = runtime.client;
  try {
  const presetOptions = (): PresetOptions => ({
    protocol: values.protocol ? parse(protocolSchema, values.protocol) : undefined,
    baseUrl: values.url, credentialEnv: values["credential-env"], authStyle: values["auth-style"] as PresetOptions["authStyle"],
    catalogBaseUrl: values["catalog-url"], catalogCredentialEnv: values["catalog-credential-env"],
    catalogAuthStyle: values["catalog-auth-style"] as PresetOptions["catalogAuthStyle"],
    catalogFormat: values["catalog-format"] as PresetOptions["catalogFormat"], catalogAccountId: values["catalog-account-id"], modelsPath: values["models-path"],
  });
  if (command === "doctor") {
    const harnesses = await Promise.all((["claude","codex","grok","opencode2","pi","cline"] as const).map(h => detectHarness(h)));
    let api: unknown;
    try { api = {mode: runtime.mode, reachable: true, health: await client.health(), ready: await client.ready()}; }
    catch { api = {mode: runtime.mode, reachable: false}; process.exitCode = 1; }
    output({version: VERSION, harnesses, api, liveVerified: false}); return;
  }
  const page = {limit:values.limit?Number(values.limit):undefined,offset:values.offset?Number(values.offset):undefined,search:values.search};
  const currentVersion = () => { const n=Number(values.version); if(!Number.isSafeInteger(n)||n<1) throw new Error("Use --version N with the record's current version."); return n; };
  if (command === "launch") {
    if (!action) throw new Error("A harness or saved profile ID is required.");
    const timeoutMs = values.timeout ? Number(values.timeout) * 1000 : undefined;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("--timeout must be positive seconds.");
    let profileId = action;
    if (values.provider) {
      const harness = parse(harnessSchema, action);
      const provider = await resolveLaunchProvider(client, values.provider, {...presetOptions(), harness});
      if (!compatible(harness, provider.protocol)) throw new Fault(422, "protocol_mismatch", "Harness does not support the saved provider's protocol.");
      const catalog = await client.refreshModels(provider.id);
      const model = values.model ?? await selectModel(catalog.models, values.search);
      const selected = catalog.models.find(m => m.id === model);
      if (!selected) throw new Fault(422, "model_missing", "Selected model is not in the provider catalog.");
      if (!codingEligible(selected)) throw new Fault(422, "model_ineligible", "Selected model explicitly lacks text output or tool support.");
      profileId = (await ensureLaunchProfile(client, provider, harness, model)).id;
    } else {
      if (values.model || values.protocol || values.url || values["credential-env"])
        throw new Error("Use --provider PROVIDER for a direct launch, or update the saved profile explicitly.");
      const profile = await client.getProfile(profileId);
      await client.refreshModels(profile.providerId);
    }
    if (values["dry-run"]) {
      const plan = await client.launchPlan(profileId);
      if (backend === "ori") {
        const {contract,warnings} = await validateOriForPlan(plan, {oriExecutable: values["ori-executable"], args: nativeArgs, cwd: values.cwd});
        output({...plan, backend: {kind: "ori", executable: contract.executable, version: contract.version, target: plan.profile.harness, provider: "openrouter", model: plan.profile.model, warnings: [...plan.warnings,...warnings]}});
      } else output(plan);
      return;
    }
    process.exitCode = await launch(client, profileId, {backend: backend as LaunchBackend, oriExecutable: values["ori-executable"], cwd: values.cwd, executable: values.executable, stateDir: values["state-dir"], args: nativeArgs, timeoutMs, refresh: false, resolveCredential: provider=>credentials.resolve(provider)});
    return;
  }
  if (command === "models" && action) {
    const provider = await resolveLaunchProvider(client, action, presetOptions());
    if (values.refresh) await client.refreshModels(provider.id);
    try { output(await client.listModels(provider.id, page)); }
    catch (error) {
      if (!(error instanceof SwitcherError && error.status === 404)) throw error;
      await client.refreshModels(provider.id); output(await client.listModels(provider.id, page));
    }
    return;
  }
  if(command==="runs") { output(action==="get"&&id?await client.getRun(id):action==="list"?await client.listRuns(page):(()=>{throw new Error("Use runs list|get ID.");})()); return; }
  if(command==="providers") {
    if(action==="presets") {output(id ? await client.getProviderPreset(id) : await client.listProviderPresets());return;}
    if(action==="list") {output(await client.listProviders(page));return;}
    if(action==="get"&&id) {output(await client.getProvider(id));return;}
    if(action==="refresh"&&id) {output(await client.refreshModels(id));return;}
    if(action==="delete"&&id) {output(await client.deleteProvider(id,currentVersion()));return;}
    if(["add","update"].includes(action)&&id) {
      const input = parse(providerInputSchema, values.file ? await readInput(values.file) : values.preset ?
        {...providerFromPreset(values.preset, {...presetOptions(), id}), ...(values.name ? {name: values.name} : {})} : {
          id, name: values.name ?? id, baseUrl: values.url, protocol: values.protocol,
          credentialEnv: values["credential-env"], authStyle: values["auth-style"],
          catalogBaseUrl: values["catalog-url"], catalogCredentialEnv: values["catalog-credential-env"],
          catalogAuthStyle: values["catalog-auth-style"], catalogFormat: values["catalog-format"], catalogAccountId: values["catalog-account-id"], modelsPath: values["models-path"],
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
  } finally { await runtime.close(); }
}
if(import.meta.main) {
  if(process.argv.slice(2).length===1&&process.argv[2]==="--version") console.log(VERSION);
  else main().catch(error=>{console.error(JSON.stringify({error:error instanceof SwitcherError?{code:error.code,message:error.message,requestId:error.requestId}:error instanceof Fault?{code:error.code,message:error.message}:{message:error instanceof Error?error.message:"Command failed."}}));process.exitCode=error instanceof CommandInterrupted ? error.exitCode : error instanceof SwitcherError && error.code === "interrupted" ? process.exitCode ?? 1 : 1;});
}
