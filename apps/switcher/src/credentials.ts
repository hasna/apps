import { z } from "zod";
import { constants } from "node:fs";
import { open, readdir, unlink, link, lstat, access, stat, realpath, readlink } from "node:fs/promises";
import { join, isAbsolute, dirname, parse as pathParts, resolve as resolvePath, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolveCredential } from "@hasna/contracts/client";
import { endpoint, Fault, CommandInterrupted, parse, type ProviderInput } from "./domain";
import { getProviderPreset, providerCredential } from "./presets";
import { privateDirectory, switcherHome } from "./runtime";

const execute = promisify(execFile);
const reference = z.string().regex(/^SWITCHER_PROVIDER_[A-Z0-9_]+$/).max(120);
const item = z.string().min(1).max(500).regex(/^[^\x00-\x1f\x7f]+$/);
const vaultKey = z.string().max(500).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/, "Use a vault key path, not an option or secret value");
const keychain = z.object({kind:z.literal("keychain"), service:item, account:item}).strict();
const operator = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("env")}).strict(),
  z.object({kind:z.literal("keychain"), account:item}).strict(),
]);
const origin = z.string().transform(value => new URL(endpoint(value)).origin);
export const credentialBindingSchema = z.object({
  schema:z.literal(1), credentialEnv:reference, origins:z.array(origin).min(1).max(30),
  source:z.discriminatedUnion("kind", [keychain, z.object({
    kind:z.literal("vault"), key:vaultKey, url:z.string().max(2000).transform(endpoint),
    executable:z.string().max(4096).regex(/^[^\x00-\x1f\x7f]+$/).refine(isAbsolute,"Secrets executable must be an absolute path"), operator,
  }).strict()]),
}).strict();
export type CredentialBinding = z.infer<typeof credentialBindingSchema>;
const fingerprint = (binding: CredentialBinding) => createHash("sha256").update(JSON.stringify(binding)).digest("hex");
export class CredentialBindings {
  readonly directory: string;
  constructor(readonly env: NodeJS.ProcessEnv = process.env) { this.directory = join(switcherHome(env),"config","credential-bindings"); }
  private path(name: string) { return join(this.directory, parse(reference,name)+".json"); }
  private async readableDirectory() {
    for (const path of [switcherHome(this.env),join(switcherHome(this.env),"config"),this.directory]) {
      let info;
      try { info = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
      if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== "win32" && ((info.mode & 0o077) || info.uid !== process.getuid?.())))
        throw new Fault(500,"credential_binding_permissions","Credential binding directories must be real, owner-only directories (mode 0700).");
    }
    return true;
  }
  async get(name: string): Promise<CredentialBinding | undefined> {
    const path = this.path(name);
    if (!await this.readableDirectory()) return undefined;
    let file;
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Fault(500,"credential_binding_unreadable","Cannot safely open the local credential binding."); }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 32768 || (process.platform !== "win32" && ((info.mode & 0o077) || info.uid !== process.getuid?.())))
        throw new Fault(500,"credential_binding_permissions","Credential binding must be an owner-only regular file (mode 0600).");
      let value: unknown;
      try { value = JSON.parse(await file.readFile("utf8")); } catch { throw new Fault(500,"credential_binding_invalid","Credential binding must contain valid JSON."); }
      const binding = parse(credentialBindingSchema,value);
      if (binding.credentialEnv !== name) throw new Fault(500,"credential_binding_invalid","Credential binding reference does not match its filename.");
      return binding;
    } finally { await file.close(); }
  }
  async list(): Promise<CredentialBinding[]> {
    if (!await this.readableDirectory()) return [];
    let entries: string[];
    try { entries = await readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const result: CredentialBinding[] = [];
    for (const name of entries.sort()) if (/^SWITCHER_PROVIDER_[A-Z0-9_]+\.json$/.test(name)) {
      const binding = await this.get(name.slice(0,-5)); if (binding) result.push(binding);
    }
    return result;
  }
  async bind(input: CredentialBinding) {
    const binding = parse(credentialBindingSchema,input);
    if (binding.source.kind === "vault") await validateVaultExecutable(binding.source.executable);
    await privateDirectory(switcherHome(this.env)); await privateDirectory(join(switcherHome(this.env),"config")); await privateDirectory(this.directory);
    const temporary = join(this.directory,`.binding-${randomUUID()}`);
    const file = await open(temporary,"wx",0o600);
    try {
      await file.writeFile(JSON.stringify(binding,null,2)+"\n"); await file.sync();
      // Publish a complete file without ever replacing a concurrent writer's binding.
      try { await link(temporary,this.path(binding.credentialEnv)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await this.get(binding.credentialEnv);
        if (existing && fingerprint(existing) === fingerprint(binding)) return existing;
        throw new Fault(409,"credential_binding_exists","A different binding already exists. Remove it explicitly before binding another credential account.");
      }
    } finally { await file.close(); await unlink(temporary); }
    return binding;
  }
  async remove(name: string) {
    const binding = await this.get(name);
    if (!binding) throw new Fault(404,"credential_binding_missing","No local credential binding exists for this reference.");
    await unlink(this.path(name)); return {removed:name};
  }
}

export function credentialReference(selector: string) {
  const name = selector.startsWith("SWITCHER_PROVIDER_") ? selector : getProviderPreset(selector).credentialEnv;
  if (!name) throw new Fault(400,"credential_reference_required","Use the explicit SWITCHER_PROVIDER_ reference for this provider.");
  return parse(reference,name);
}

export async function validateVaultExecutable(path: string) {
  let info, resolved: string;
  try {
    resolved = await realpath(path);
    await access(resolved,constants.X_OK);
    info = await stat(resolved);
    if (!info.isFile()) throw new Error();
  }
  catch { throw new Fault(422,"vault_exec_unavailable","The configured secrets CLI must be an installed executable file. Use --vault-cli with its absolute path."); }
  if (process.platform !== "win32" && ((info.mode & 0o022) || (info.uid !== 0 && info.uid !== process.getuid?.())))
    throw new Fault(422,"vault_exec_permissions","The secrets executable must be owned by this user or root and not writable by other users. Remove group/public write permission from its resolved file or choose a trusted installation.");
  if (process.platform !== "win32") {
    const seen = new Set<string>();
    const inspect = async (candidate: string): Promise<void> => {
      let prefix = pathParts(candidate).root;
      for (const part of candidate.slice(prefix.length).split(sep)) {
        if (!part) continue;
        prefix = join(prefix,part);
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        if (seen.size > 256) throw new Fault(422,"vault_exec_permissions","The secrets executable path has too many symlink components.");
        const entry = await lstat(prefix);
        if ((entry.uid !== 0 && entry.uid !== process.getuid?.()) || (!entry.isSymbolicLink() && (entry.mode & 0o022)))
          throw new Fault(422,"vault_exec_permissions","The secrets executable and its ancestor directories must not be replaceable by other users. Choose an installation owned by this user or root without group/public write permissions.");
        if (entry.isSymbolicLink()) await inspect(resolvePath(dirname(prefix),await readlink(prefix)));
      }
    };
    try { await inspect(path); await inspect(resolved); }
    catch (error) { if (error instanceof Fault) throw error; throw new Fault(422,"vault_exec_unavailable","The secrets executable path changed or could not be verified. Retry with a trusted installation."); }
  }
  return resolved;
}

export function bindingTarget(selector: string, override?: string, allowedOrigins?: string[]) {
  if (selector.startsWith("SWITCHER_PROVIDER_")) {
    if (override) throw new Fault(400,"conflicting_options","A credential reference does not also need --credential-env.");
    if (!allowedOrigins?.length) throw new Fault(400,"credential_origin_required","Use --origin URL to authorize a custom credential destination.");
    return {credentialEnv:parse(reference,selector),origins:allowedOrigins.map(value=>new URL(endpoint(value)).origin)};
  }
  const preset = getProviderPreset(selector);
  const credentialEnv = override ?? preset.credentialEnv;
  if (!credentialEnv) throw new Fault(400,"credential_reference_required","Use --credential-env for a preset without a default credential reference.");
  const origins = allowedOrigins ?? [...new Set(preset.protocols.flatMap(route=>route.baseUrl?[new URL(route.baseUrl).origin]:[]))];
  if (!origins.length) throw new Fault(400,"credential_origin_required","Use --origin URL for this custom preset.");
  return {credentialEnv:parse(reference,credentialEnv),origins};
}

async function readKeychain(source: z.infer<typeof keychain>): Promise<string> {
  if (process.platform !== "darwin") throw new Fault(422,"keychain_unavailable","This binding requires macOS Keychain. Use a supported vault binding or runtime environment on this station.");
  try {
    const {stdout} = await execute("/usr/bin/security",["find-generic-password","-a",source.account,"-s",source.service,"-w"],{encoding:"utf8",timeout:10_000,maxBuffer:65536});
    const value = stdout.replace(/\r?\n$/,"");
    if (!value || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid credential");
    return value;
  } catch { throw new Fault(422,"keychain_unavailable","The configured Keychain item is missing, locked, or inaccessible; no alternate credential was selected."); }
}

export class CredentialResolver {
  readonly bindings: CredentialBindings;
  constructor(readonly env: NodeJS.ProcessEnv = process.env, private readonly keychainRead = readKeychain) { this.bindings = new CredentialBindings(env); }
  async resolve(provider: ProviderInput): Promise<string | undefined> {
    if (!provider.credentialEnv) return undefined;
    const binding = await this.bindings.get(provider.credentialEnv);
    if (!binding) return providerCredential(provider,this.env);
    if (!binding.origins.includes(new URL(provider.baseUrl).origin))
      throw new Fault(422,"credential_authority","The local credential binding does not authorize this provider origin. Update the binding explicitly; no key was sent.");
    if (binding.source.kind === "keychain") return this.keychainRead(binding.source);
    return fetchVaultCredential(binding,this.env);
  }
  async check(name: string) {
    const binding = await this.bindings.get(name);
    if (!binding) throw new Fault(404,"credential_binding_missing","No local credential binding exists for this reference.");
    if (binding.source.kind === "vault") {
      const output = await runVaultCommand(binding,["get",binding.source.key,"--check"],this.env,{},true);
      const match = /^key=\S+ length=(\d+) sha256=([a-f0-9]{64})\s*$/.exec(output);
      if (!match) throw new Fault(422,"vault_check_failed","The secrets CLI did not return a supported credential check result.");
      return {credentialEnv:name,source:"vault",available:true,length:Number(match[1]),sha256:match[2],providerAuthentication:"not tested"};
    }
    const value = await this.keychainRead(binding.source);
    return {credentialEnv:name,source:"keychain",available:true,length:Buffer.byteLength(value),sha256:createHash("sha256").update(value).digest("hex"),providerAuthentication:"not tested"};
  }
}

const DELIVERY_URL = "SWITCHER_CREDENTIAL_DELIVERY_URL";
const DELIVERY_NONCE = "SWITCHER_CREDENTIAL_DELIVERY_NONCE";
const DELIVERY_VALUE = "SWITCHER_CREDENTIAL_DELIVERY_VALUE";
export class CredentialInterrupted extends CommandInterrupted {
  constructor(exitCode: number) { super(exitCode,"Credential lookup was interrupted; no harness was started."); }
}

/** Select an operator through the shared credential seam, then pin that choice. */
function vaultEnvironment(binding: CredentialBinding, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (binding.source.kind !== "vault") throw new Fault(500,"credential_resolution","Unexpected credential source.");
  let credential;
  try {
    credential = binding.source.operator.kind === "keychain"
      ? resolveCredential("secrets",{HASNA_STATION:binding.source.operator.account},{keychain:{enabled:true}})
      : resolveCredential("secrets",Object.fromEntries(Object.entries(env).filter(([name])=>name==="HASNA_SECRETS_API_KEY")),{keychain:{enabled:false}});
  } catch { throw new Fault(422,"vault_operator_unavailable","The configured vault operator credential is inaccessible; no alternate account was selected."); }
  if (!credential?.apiKey) throw new Fault(422,"vault_operator_missing","Configure the vault operator Keychain account or inject HASNA_SECRETS_API_KEY for this process.");
  // Pass only execution/config context, not unrelated fleet/provider credentials or
  // deliberate profile/pointer overrides. The explicit override prevents the
  // Secrets CLI from reselecting an ambient Keychain/disk operator. Its shared URL
  // resolver may still reject a conflicting local authority; that remains terminal.
  const allowed = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z_]+|TMPDIR|TEMP|TMP|HASNA_SECRETS_HOME|HASNA_STATION)$/;
  const next: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(env).filter(([name])=>allowed.test(name)));
  next.HASNA_SECRETS_API_URL = binding.source.url;
  next.HASNA_SECRETS_API_KEY = credential.apiKey;
  next.HASNA_SECRETS_API_KEY_OVERRIDE = credential.apiKey;
  if (binding.source.operator.kind === "keychain") next.HASNA_STATION = binding.source.operator.account;
  return next;
}

/** Vault children never own a harness or a TTY; their entire process group is bounded. */
async function runVaultCommand(binding: CredentialBinding, args: string[], env: NodeJS.ProcessEnv, delivery: NodeJS.ProcessEnv = {}, captureCheck = false): Promise<string> {
  if (binding.source.kind !== "vault") throw new Fault(500,"credential_resolution","Unexpected credential source.");
  if (process.platform === "win32") throw new Fault(422,"vault_exec_unavailable","Vault CLI bindings currently require POSIX process groups; use runtime environment injection on Windows.");
  const executable = await validateVaultExecutable(binding.source.executable);
  const childEnv = {...vaultEnvironment(binding,env),...delivery};
  return new Promise((resolveResult,reject) => {
    const child = spawn(executable,args,{env:childEnv,stdio:["ignore",captureCheck ? "pipe" : "ignore","ignore"],detached:true,shell:false});
    let failure: Fault | undefined;
    let output = "";
    let cleaned = false;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid,"SIGKILL"); } catch {} } };
    const interrupt = (signal: "SIGINT" | "SIGTERM") => { failure = new CredentialInterrupted(signal === "SIGINT" ? 130 : 143); process.exitCode = signal === "SIGINT" ? 130 : 143; kill(); };
    const onInt = () => interrupt("SIGINT"); const onTerm = () => interrupt("SIGTERM");
    process.on("SIGINT",onInt); process.on("SIGTERM",onTerm);
    const timeout = setTimeout(()=>{ failure = new Fault(504,"vault_timeout","Credential lookup exceeded 20 seconds; no alternate credential was selected."); kill(); },20_000);
    const cleanup = () => { if (cleaned) return; cleaned = true; clearTimeout(timeout); process.off("SIGINT",onInt); process.off("SIGTERM",onTerm); kill(); };
    child.stdout?.on("data",(chunk: Buffer) => {
      if (output.length + chunk.length > 4096) { failure = new Fault(422,"vault_check_failed","The secrets CLI returned an oversized check result."); kill(); }
      else output += chunk.toString("utf8");
    });
    child.once("error",()=>{ cleanup(); reject(new Fault(422,"vault_exec_failed","The configured secrets CLI could not start; check its executable and permissions.")); });
    child.once("exit",cleanup);
    child.once("close",code=>{
      if (failure) reject(failure);
      else if (code !== 0) reject(new Fault(422,"vault_lookup_failed","The secrets CLI could not read the configured key. Check vault access and conflicting local vault URL settings; no alternate account was selected."));
      else resolveResult(output);
    });
  });
}

/** The installed secrets CLI injects into a short-lived receiver, never stdout. */
async function fetchVaultCredential(binding: CredentialBinding, env: NodeJS.ProcessEnv) {
  if (binding.source.kind !== "vault") throw new Fault(500,"credential_resolution","Unexpected credential source.");
  const nonce = crypto.randomUUID()+crypto.randomUUID();
  let value: string | undefined;
  const broker = Bun.serve({hostname:"127.0.0.1",port:0,maxRequestBodySize:65536,async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/credential" || request.headers.get("authorization") !== `Bearer ${nonce}` || value !== undefined)
      return new Response(null,{status:404});
    let candidate: unknown;
    try { candidate = await request.json(); } catch { return new Response(null,{status:400}); }
    if (typeof candidate !== "string" || !candidate || candidate.length > 64000 || /[\x00-\x1f\x7f]/.test(candidate)) return new Response(null,{status:400});
    value = candidate;
    return new Response(null,{status:204});
  }});
  try {
    await runVaultCommand(binding,["exec",binding.source.key,"--as",DELIVERY_VALUE,"--",process.execPath,process.argv[1],"__credential-delivery"],env,{
      [DELIVERY_URL]:broker.url.origin+"/credential",[DELIVERY_NONCE]:nonce,
    });
    if (!value) throw new Fault(422,"vault_delivery_failed","The secrets CLI completed without a valid credential handoff.");
    return value;
  } finally { await broker.stop(true); }
}

/** Internal child mode: the key travels only through an authenticated loopback request. */
export async function deliverVaultCredential() {
  const address = process.env[DELIVERY_URL]; const nonce = process.env[DELIVERY_NONCE]; const value = process.env[DELIVERY_VALUE];
  if (!address || !nonce || !value) throw new Fault(400,"credential_delivery_invalid","Credential delivery requires an owned vault lookup.");
  let url: URL;
  try { url = new URL(address); } catch { throw new Fault(400,"credential_delivery_invalid","Invalid credential delivery address."); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/credential" || url.username || url.password || url.search || url.hash)
    throw new Fault(400,"credential_delivery_invalid","Credential delivery is restricted to the owned loopback receiver.");
  try {
    const response = await fetch(url,{method:"POST",headers:{authorization:`Bearer ${nonce}`,"content-type":"application/json"},body:JSON.stringify(value),redirect:"error",signal:AbortSignal.timeout(5000)});
    if (response.status !== 204) throw new Error();
  } catch { throw new Fault(422,"credential_delivery_failed","The owned credential receiver was unavailable."); }
}
