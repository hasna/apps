import { z } from "zod";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { authHeader } from "./auth";
import { discover, type CatalogCredentialResolver } from "./catalog";
import { codingEligible, Fault, CommandInterrupted, parse, type Catalog, type Model, type Provider, type ProviderInput } from "./domain";
import { SwitcherClient, SwitcherError } from "./sdk";
import { CredentialBindings, CredentialResolver, credentialBindingSchema, resolveVaultOperatorEnvironment, runVaultCommand, validateVaultExecutable, vaultKeySchema, type VaultOperatorResolution } from "./credentials";

const absent = (error: unknown) => error instanceof SwitcherError && error.status === 404;

const secretMetadataSchema = z.object({
  key:vaultKeySchema,type:z.enum(["api_key","password","token","credential","other"]),label:z.string().max(1000).nullable().optional(),
  expires_at:z.string().max(200).nullable().optional(),created_at:z.string().max(200),updated_at:z.string().max(200),
}).strict();
export type VaultCredentialReference = {
  account:string;key:string;url?:string;executable:string;
  operator:{kind:"contracts";expectedSource?:string;expectedTier?:VaultOperatorResolution["tier"]}|{kind:"env"}|{kind:"keychain";account:string};
};
type CredentialResolverLike = Pick<CredentialResolver,"resolve"> & {bindings:Pick<CredentialBindings,"get"|"bind">};
export type ProviderAuthenticationResult = {authenticated:boolean;status?:number;unsupported?:boolean};
export type EnsureProviderCredentialOptions = {
  interactive?:boolean;resolver?:CredentialResolverLike;env?:NodeJS.ProcessEnv;vaultExecutable?:string;
  discoverVaultReferences?:(request:{provider:ProviderInput;credentialEnv:string})=>Promise<VaultCredentialReference[]>;
  selectVaultReference?:(request:{provider:ProviderInput;matches:VaultCredentialReference[]})=>Promise<VaultCredentialReference|undefined>;
  verifyProviderAuthentication?:(request:{provider:ProviderInput;credential:string})=>Promise<ProviderAuthenticationResult>;
};
export type PreparedProviderCredential = {
  source:"not-required"|"environment"|"binding";configured:boolean;verified:boolean;providerFingerprint:string;
  readonly resolveCredential:(provider:ProviderInput)=>Promise<string|undefined>;
};

const cleanDisplay = (value:string) => value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,"").slice(0,500);
const credentialOrigins = (provider:ProviderInput) => {
  const origins = new Set([new URL(provider.baseUrl).origin]);
  const catalogAuthStyle = provider.catalogAuthStyle ?? provider.authStyle ?? "bearer";
  const catalogCredentialEnv = provider.catalogCredentialEnv ?? provider.credentialEnv;
  if (catalogAuthStyle !== "none" && provider.catalogBaseUrl && catalogCredentialEnv === provider.credentialEnv)
    origins.add(new URL(provider.catalogBaseUrl).origin);
  return [...origins];
};
export const providerCredentialSetupCommand = (provider:ProviderInput) => {
  if (!provider.credentialEnv) return "";
  const origins = credentialOrigins(provider).map(value=>` --origin ${value}`).join("");
  return `switcher credentials bind ${provider.credentialEnv}${origins} --vault-key <vault-key>`;
};
const searchTerms = (provider:ProviderInput) => {
  const fromReference = provider.credentialEnv?.replace(/^SWITCHER_PROVIDER_/,"").replace(/_API_KEY$/,"").toLowerCase().replace(/_/g,"-");
  const raw = [fromReference,provider.name.toLowerCase().replace(/[^a-z0-9]+/g,"-"),provider.id.toLowerCase()];
  return [...new Set(raw.flatMap(value=>value?[value,...value.split("-")]:[]).filter(value=>value.length>=3&&!new Set(["api","key","provider","responses","response","messages","message","chat","custom"]).has(value)))].slice(0,4);
};

export async function discoverVaultReferences(provider:ProviderInput, env:NodeJS.ProcessEnv = process.env, vaultExecutable = Bun.which("secrets") ?? ""):Promise<VaultCredentialReference[]> {
  if (!provider.credentialEnv) return [];
  if (!vaultExecutable) throw new Fault(422,"vault_exec_unavailable","Hasna Secrets is not installed in this launcher process. Install it or run the exact credentials bind command with --vault-cli /absolute/path.");
  await validateVaultExecutable(vaultExecutable);
  const source = {kind:"vault" as const,key:"switcher/provider-credential-discovery",executable:vaultExecutable,operator:{kind:"contracts" as const}};
  const provisional = parse(credentialBindingSchema,{schema:1,credentialEnv:provider.credentialEnv,origins:credentialOrigins(provider),source});
  const operator = await resolveVaultOperatorEnvironment(provisional,env);
  const entries = new Map<string,z.infer<typeof secretMetadataSchema>>();
  for (const query of searchTerms(provider)) {
    const output = await runVaultCommand(provisional,["search",query,"--json"],env,{}, {
      captureBytes:256*1024,oversizeCode:"vault_metadata_oversized",oversizeMessage:"Secrets returned too much credential metadata; narrow the vault naming or bind an exact key explicitly.",
      lookupCode:"vault_search_failed",lookupMessage:"Hasna Secrets could not search credential metadata. Check the selected vault/Keychain source; no alternate account was selected.",operator,
    });
    let parsed:unknown;
    try { parsed=JSON.parse(output); } catch { throw new Fault(422,"vault_metadata_invalid","Hasna Secrets returned invalid credential metadata JSON."); }
    const result=secretMetadataSchema.array().max(1000).safeParse(parsed);
    if(!result.success)throw new Fault(422,"vault_metadata_invalid","Hasna Secrets returned an unsupported credential metadata shape.");
    for(const entry of result.data)entries.set(entry.key,entry);
    if(entries.size>256)throw new Fault(422,"credential_matches_too_many","More than 256 credential references matched. Bind an exact vault key explicitly.");
  }
  return [...entries.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(entry=>({account:operator.source,key:entry.key,url:operator.url,executable:vaultExecutable,operator:{kind:"contracts" as const,expectedSource:operator.source,expectedTier:operator.tier}}));
}

export async function selectVaultReference({provider,matches}:{provider:ProviderInput;matches:VaultCredentialReference[]}) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return undefined;
  console.error(`Secrets account/source: ${cleanDisplay(matches[0]?.account??"unknown")}`);
  console.error(`Credential references matching ${cleanDisplay(provider.name)}:`);
  matches.forEach((match,index)=>console.error(`  ${index+1}. ${cleanDisplay(match.key)}${match.account===matches[0]?.account?"":` (account/source: ${cleanDisplay(match.account)})`}`));
  const reader=createInterface({input:process.stdin,output:process.stderr});
  const cancellation=new AbortController();
  const cancel=()=>cancellation.abort(new CommandInterrupted(130,"Credential setup was cancelled; no binding was saved and no harness was started."));
  const terminate=()=>cancellation.abort(new CommandInterrupted(143,"Credential setup was interrupted; no binding was saved and no harness was started."));
  reader.on("SIGINT",cancel);reader.on("close",cancel);process.on("SIGINT",cancel);process.on("SIGTERM",terminate);
  try{
    for(;;){
      const answer=(await reader.question("Credential number (Ctrl-C cancels): ",{signal:cancellation.signal}).catch(error=>{throw cancellation.signal.aborted?cancellation.signal.reason:error;})).trim();
      if(!answer||/^(q|quit|cancel)$/i.test(answer))return undefined;
      if(/^[1-9]\d*$/.test(answer)&&matches[Number(answer)-1])return matches[Number(answer)-1];
      console.error(`Enter a number from 1 to ${matches.length}, or q to cancel.`);
    }
  }finally{reader.off("SIGINT",cancel);reader.off("close",cancel);process.off("SIGINT",cancel);process.off("SIGTERM",terminate);reader.close();}
}

function authenticationProbe(provider:ProviderInput):{url:URL;method:"GET"|"HEAD";authStyle:"bearer"|"x-api-key"|"api-key"}|undefined {
  if(provider.credentialCheck){
    const root=provider.baseUrl.endsWith("/")?provider.baseUrl:`${provider.baseUrl}/`;
    const url=new URL(provider.credentialCheck.path,root);
    if(url.origin!==new URL(provider.baseUrl).origin||!url.href.startsWith(root))throw new Fault(422,"provider_auth_check_invalid","Provider authentication check must remain below its inference endpoint.");
    return {url,method:provider.credentialCheck.method??"GET",authStyle:provider.authStyle??"bearer"};
  }
  const base=new URL(provider.baseUrl);
  if(provider.credentialEnv==="SWITCHER_PROVIDER_OPENROUTER"&&base.origin==="https://openrouter.ai"&&base.pathname.replace(/\/+$/,"")==="/api/v1")
    return {url:new URL("https://openrouter.ai/api/v1/key"),method:"GET",authStyle:provider.authStyle??"bearer"};
  return undefined;
}

export async function verifyProviderAuthentication({provider,credential,fetch:fetchImpl=fetch}:{provider:ProviderInput;credential:string;fetch?:typeof fetch}):Promise<ProviderAuthenticationResult>{
  const probe=authenticationProbe(provider);if(!probe)return {authenticated:false,unsupported:true};
  const [header,value]=authHeader(probe.authStyle,credential);const headers:Record<string,string>={accept:"application/json","user-agent":"hasna-switcher/credential-check"};
  headers[provider.catalogFormat==="gemini"&&header==="x-api-key"?"x-goog-api-key":header]=value;
  if(provider.protocol==="anthropic-messages"&&probe.url.hostname!=="openrouter.ai")headers["anthropic-version"]="2023-06-01";
  let response:Response;
  try{response=await fetchImpl(probe.url,{method:probe.method,headers,redirect:"manual",signal:AbortSignal.timeout(10_000)});}catch{throw new Fault(502,"provider_auth_unavailable","Provider authentication check could not reach the configured authority. Retry without changing accounts.");}
  const status=response.status;await response.body?.cancel().catch(()=>{});
  if(status>=200&&status<300)return {authenticated:true,status};
  if(status===401||status===403)return {authenticated:false,status};
  if(status>=300&&status<400)throw new Fault(502,"provider_auth_unavailable","Provider authentication check returned a redirect; credentials were not forwarded.");
  throw new Fault(502,"provider_auth_unavailable",`Provider authentication check returned HTTP ${status}; the selected credential was not replaced.`);
}

export function providerCredentialFingerprint(provider:ProviderInput){return createHash("sha256").update(JSON.stringify({
  id:provider.id,baseUrl:provider.baseUrl,protocol:provider.protocol,authStyle:provider.authStyle??"bearer",credentialEnv:provider.credentialEnv??null,credentialCheck:provider.credentialCheck??null,
})).digest("hex");}

function preparedProviderCredential(provider:ProviderInput,credential:string|undefined,fields:Omit<PreparedProviderCredential,"resolveCredential"|"providerFingerprint">):PreparedProviderCredential{
  const providerFingerprint=providerCredentialFingerprint(provider);
  const prepared={...fields,providerFingerprint} as PreparedProviderCredential;
  Object.defineProperty(prepared,"resolveCredential",{enumerable:false,configurable:false,writable:false,value:async(candidate:ProviderInput)=>{
    if(providerCredentialFingerprint(candidate)!==providerFingerprint)throw new Fault(409,"credential_preflight_changed","The provider authority or credential contract changed after authentication. Retry the launch; no credential was sent.");
    return credential;
  }});
  return Object.freeze(prepared);
}

export async function ensureProviderCredential(provider:ProviderInput,options:EnsureProviderCredentialOptions={}):Promise<PreparedProviderCredential>{
  if(!provider.credentialEnv)return preparedProviderCredential(provider,undefined,{source:"not-required",configured:false,verified:false});
  const resolver=options.resolver??new CredentialResolver(options.env??process.env);
  const existing=await resolver.bindings.get(provider.credentialEnv);
  let credential=await resolver.resolve(provider);
  if(existing&&!credential)throw new Fault(422,"credential_binding_unavailable","The selected credential binding did not provide a usable value; no alternate account was selected.");
  let configured=false;
  if(!credential){
    if(!(options.interactive??(process.stdin.isTTY&&process.stderr.isTTY)))throw new Fault(400,"credential_setup_required",`Provider credential setup is required. Run: ${providerCredentialSetupCommand(provider)}. Or provide ${provider.credentialEnv} in this launch process.`);
    const discover=options.discoverVaultReferences??(request=>discoverVaultReferences(request.provider,options.env??process.env,options.vaultExecutable));
    let matches:VaultCredentialReference[];
    try{matches=await discover({provider,credentialEnv:provider.credentialEnv});}
    catch(error){
      if(error instanceof Fault&&error.code==="vault_exec_unavailable")throw new Fault(error.status,error.code,`${error.message} Run: ${providerCredentialSetupCommand(provider)} --vault-cli /absolute/path/to/secrets.`);
      throw error;
    }
    if(!matches.length)throw new Fault(404,"credential_match_missing",`No matching Hasna Secrets credential reference was found for ${provider.name}. Run: ${providerCredentialSetupCommand(provider)}.`);
    const select=options.selectVaultReference??selectVaultReference;
    const candidate=await select({provider,matches});
    if(!candidate)throw new CommandInterrupted(130,"Credential setup was cancelled; no binding was saved and no harness was started.");
    const selected=matches.find(match=>match.account===candidate.account&&match.key===candidate.key&&match.executable===candidate.executable&&JSON.stringify(match.operator)===JSON.stringify(candidate.operator));
    if(!selected)throw new Fault(400,"credential_selection_invalid","Choose one of the displayed credential references.");
    const source={kind:"vault" as const,key:selected.key,...(selected.url?{url:selected.url}:{}),executable:selected.executable,operator:selected.operator};
    await resolver.bindings.bind(parse(credentialBindingSchema,{schema:1,credentialEnv:provider.credentialEnv,origins:credentialOrigins(provider),requireProviderAuthentication:true,source}));
    configured=true;credential=await resolver.resolve(provider);
    if(!credential)throw new Fault(422,"vault_delivery_failed","The selected credential reference did not provide a usable value; no alternate account was selected.");
  }
  const verify=options.verifyProviderAuthentication??(request=>verifyProviderAuthentication(request));
  const result=await verify({provider,credential});
  if(result.unsupported){
    if(configured||existing?.requireProviderAuthentication)throw new Fault(422,"provider_auth_check_unsupported",`This provider has no configured non-inference authentication check.${configured?" The selected binding was preserved.":""} Configure credentialCheck before launch; no unverified credential was sent.`);
    return preparedProviderCredential(provider,credential,{source:existing?"binding":"environment",configured,verified:false});
  }
  if(!result.authenticated)throw new Fault(401,"provider_credential_rejected",`The provider rejected the selected credential${result.status?` with HTTP ${result.status}`:""}. No alternate account was selected.${existing||configured?` To choose a different reference, run: switcher credentials remove ${provider.credentialEnv}.`:""}`);
  return preparedProviderCredential(provider,credential,{source:existing||configured?"binding":"environment",configured,verified:true});
}

function catalogRequiresCredential(provider:Provider){
  if(provider.manualModels.length)return false;
  return (provider.catalogAuthStyle??provider.authStyle)!=="none"&&Boolean(provider.catalogCredentialEnv??provider.credentialEnv);
}

export type LaunchCatalogOptions = {clientSide?:boolean;credential?:string;resolveCredential?:CatalogCredentialResolver};
export async function launchCatalog(client:SwitcherClient,provider:Provider,dryRun=false,options:LaunchCatalogOptions={}):Promise<Catalog>{
  if(!dryRun&&options.clientSide){
    const origins=credentialOrigins(provider);
    const resolve:CatalogCredentialResolver=async candidate=>{
      if(options.credential&&candidate.credentialEnv===provider.credentialEnv&&origins.includes(new URL(candidate.baseUrl).origin))return options.credential;
      return options.resolveCredential?.(candidate);
    };
    const catalog=await discover(provider,{},resolve);
    return client.saveCatalog(provider.id,provider.version,catalog);
  }
  if(!dryRun||!catalogRequiresCredential(provider))return client.refreshModels(provider.id);
  const models:Model[]=[];let offset=0,refreshedAt:string|undefined,source:Catalog["source"]|undefined,total:number|undefined;
  for(let pageNumber=0;pageNumber<10;pageNumber++){
    let page:Awaited<ReturnType<SwitcherClient["listModels"]>>;
    try{page=await client.listModels(provider.id,{limit:1000,offset});}
    catch(error){if(absent(error))throw new Fault(400,"dry_run_catalog_unavailable",`Dry-run will not retrieve provider credentials. Refresh ${provider.id} explicitly with switcher models ${provider.id} --refresh, then rerun the plan.`);throw error;}
    if(total===undefined){total=page.total;refreshedAt=page.refreshedAt;source=page.source;}
    else if(total!==page.total||refreshedAt!==page.refreshedAt||source!==page.source)throw new Fault(409,"catalog_changed","The cached catalog changed while the dry-run plan was being read; retry.");
    for(const row of page.data){const {codingEligible:_codingEligible,expired:_expired,...model}=row;models.push(model);}
    offset+=page.data.length;if(offset>=page.total)break;if(!page.data.length)throw new Fault(502,"invalid_catalog","The cached catalog page did not advance.");
  }
  if(total===undefined||models.length!==total||!refreshedAt||!source)throw new Fault(502,"invalid_catalog","The cached catalog exceeds the bounded dry-run reader or is incomplete.");
  return {models,refreshedAt,source};
}
