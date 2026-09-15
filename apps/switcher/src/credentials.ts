import { z } from "zod";
import { constants } from "node:fs";
import { open, readdir, unlink, link, lstat, access, stat, realpath, readlink, rename } from "node:fs/promises";
import { join, isAbsolute, dirname, parse as pathParts, resolve as resolvePath, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { resolveCredential, resolveClientTransport, toV1BaseUrl, clientTransportEnvKeys, keychainConfigValue, appConfigDiskValue, type CredentialChainOptions } from "@hasna/contracts/client";
import { endpoint, Fault, CommandInterrupted, parse, type ProviderInput } from "./domain";
import { getProviderPreset, providerCredential } from "./presets";
import { privateDirectory, switcherHome } from "./runtime";
import { authHeader } from "./auth";

const execute = promisify(execFile);
const reference = z.string().regex(/^SWITCHER_PROVIDER_[A-Z0-9_]+$/).max(120);
const item = z.string().min(1).max(500).regex(/^[^\x00-\x1f\x7f]+$/);
const vaultKey = z.string().max(500).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/, "Use a vault key path, not an option or secret value");
const keychain = z.object({kind:z.literal("keychain"), service:item, account:item}).strict();
const operator = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("contracts")}).strict(),
  z.object({kind:z.literal("env")}).strict(),
  z.object({kind:z.literal("keychain"), account:item.refine(value=>value.trim().length>0 && value===value.trim(),"Vault account must be nonblank without surrounding whitespace")}).strict(),
]);
const origin = z.string().transform(value => new URL(endpoint(value)).origin);
export const credentialBindingSchema = z.object({
  schema:z.literal(1), credentialEnv:reference, origins:z.array(origin).min(1).max(30),
  source:z.discriminatedUnion("kind", [keychain, z.object({
    kind:z.literal("vault"), key:vaultKey, url:z.string().max(2000).transform(endpoint).optional(),
    executable:z.string().max(4096).regex(/^[^\x00-\x1f\x7f]+$/).refine(isAbsolute,"Secrets executable must be an absolute path"), operator,
  }).strict()]),
}).strict().superRefine((binding,ctx)=>{
  if (binding.source.kind === "vault" && binding.source.operator.kind !== "contracts" && !binding.source.url)
    ctx.addIssue({code:"custom",path:["source","url"],message:"An explicit env or Keychain operator binding requires a vault URL."});
});
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

async function inspectVaultExecutable(path: string, permitWritableFile = false) {
  let info, resolved: string;
  try {
    resolved = await realpath(path);
    await access(resolved,constants.X_OK);
    info = await stat(resolved);
    if (!info.isFile()) throw new Error();
  }
  catch { throw new Fault(422,"vault_exec_unavailable","The configured secrets CLI must be an installed executable file. Use --vault-cli with its absolute path."); }
  if (process.platform !== "win32" && ((!permitWritableFile && (info.mode & 0o022)) || (info.uid !== 0 && info.uid !== process.getuid?.())))
    throw new Fault(422,"vault_exec_permissions","The secrets executable must be owned by this user or root and not writable by other users. Choose a trusted installation, or use credentials repair-executable REFERENCE --sha256 EXPECTED with the executable digest from a verified package artifact. Launch never repairs permissions automatically.");
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
        const permittedFile = permitWritableFile && prefix === resolved && entry.isFile();
        if ((entry.uid !== 0 && entry.uid !== process.getuid?.()) || (!entry.isSymbolicLink() && !permittedFile && (entry.mode & 0o022)))
          throw new Fault(422,"vault_exec_permissions","The secrets executable and its ancestor directories must not be replaceable by other users. Choose an installation owned by this user or root without group/public write permissions.");
        if (entry.isSymbolicLink()) await inspect(resolvePath(dirname(prefix),await readlink(prefix)));
      }
    };
    try { await inspect(path); await inspect(resolved); }
    catch (error) { if (error instanceof Fault) throw error; throw new Fault(422,"vault_exec_unavailable","The secrets executable path changed or could not be verified. Retry with a trusted installation."); }
  }
  return resolved;
}

export async function validateVaultExecutable(path: string) { return inspectVaultExecutable(path); }

/** Explicit install finalization. The caller supplies a digest from a verified
 * artifact, never a digest computed from the currently installed executable.
 * No credential is resolved and the executable is never started. */
export async function repairVaultExecutablePermissions(path: string, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Fault(400,"invalid_request","--sha256 requires the SHA256 of the executable member from a verified package artifact.");
  if (!isAbsolute(path) || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) throw new Fault(400,"invalid_request","Secrets executable must be an absolute path without control characters.");
  if (process.platform === "win32") throw new Fault(422,"vault_exec_repair_unsafe","Executable permission repair requires POSIX file permissions.");
  const resolved = await inspectVaultExecutable(path,true);
  const file = await open(resolved,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const unsafe = () => new Fault(422,"vault_exec_repair_unsafe","Executable ownership, type, links or contents changed; no trusted repair can be confirmed.");
  let temporary: string | undefined;
  try {
    const before = await file.stat();
    const limit = 256 * 1024 * 1024;
    if (!before.isFile() || before.uid !== process.getuid?.() || before.size > limit || (before.mode & 0o7000)) throw unsafe();
    const sameFile = (info: typeof before) => info.dev === before.dev && info.ino === before.ino && info.size === before.size && info.uid === before.uid && info.nlink === before.nlink && info.mode === before.mode && info.mtimeMs === before.mtimeMs && info.ctimeMs === before.ctimeMs;
    const hash = async (target?: typeof file) => {
      const digest = createHash("sha256"); const buffer = Buffer.alloc(1024 * 1024); let position = 0;
      while (true) {
        const {bytesRead} = await file.read(buffer,0,buffer.length,position);
        if (!bytesRead) break;
        position += bytesRead; if (position > limit) throw unsafe();
        const bytes = buffer.subarray(0,bytesRead); digest.update(bytes);
        if (target) await target.writeFile(bytes);
      }
      if (position !== before.size || !sameFile(await file.stat())) throw unsafe();
      if (digest.digest("hex") !== expectedSha256) throw new Fault(422,"vault_exec_digest_mismatch","Installed executable differs from the trusted artifact digest. Reinstall the verified package; no credential was accessed.");
    };
    await hash();
    const mode = (before.mode & 0o777) & ~0o022;
    const changed = mode !== (before.mode & 0o777);
    if (await inspectVaultExecutable(path,true) !== resolved || !sameFile(await lstat(resolved))) throw unsafe();
    if (!changed) { await validateVaultExecutable(path); return {changed,mode:mode.toString(8).padStart(4,"0"),sha256:expectedSha256}; }
    // Every writable inode is replaced, including nlink=1: chmod cannot revoke
    // an already-open writer fd. Cache hardlinks retain their original inode.
    temporary = join(dirname(resolved),`.switcher-repair-${randomUUID()}`);
    const replacement = await open(temporary,"wx",0o600);
    try {
      await hash(replacement);
      await replacement.chmod(mode); await replacement.sync();
      const ready = await replacement.stat();
      if (!ready.isFile() || ready.nlink !== 1 || ready.uid !== before.uid || ready.size !== before.size) throw unsafe();
      if (await inspectVaultExecutable(path,true) !== resolved || !sameFile(await lstat(resolved))) throw unsafe();
      await rename(temporary,resolved); temporary = undefined;
      const installed = await lstat(resolved);
      if (installed.dev !== ready.dev || installed.ino !== ready.ino || await validateVaultExecutable(path) !== resolved) throw unsafe();
      const directory = await open(dirname(resolved),constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await replacement.close(); }
    return {changed,mode:mode.toString(8).padStart(4,"0"),sha256:expectedSha256};
  } finally { await file.close(); if (temporary) await unlink(temporary); }
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
  // A binding names a user-chosen service/account, which @hasna/contracts'
  // Keychain tier (hasna.credentials.<app>.*) cannot address, so the exact
  // `security` status is classified here the same way the shared tier does:
  // absent (44) and unreadable (locked, denied) are both terminal, never a fallback.
  let stdout: string;
  try { ({stdout} = await execute("/usr/bin/security",["find-generic-password","-a",source.account,"-s",source.service,"-w"],{encoding:"utf8",timeout:10_000,maxBuffer:65536})); }
  catch (error) {
    const status = (error as {code?: unknown}).code;
    if (status === 44) throw new Fault(422,"keychain_item_missing","The configured Keychain item does not exist for that service and account; no alternate credential was selected.");
    throw new Fault(422,"keychain_unavailable",`The configured Keychain item could not be read (security exited ${typeof status === "number" ? status : "without a status"}); it is locked or inaccessible. No alternate credential was selected.`);
  }
  const value = stdout.replace(/\r?\n$/,"");
  if (!value || /[\x00-\x1f\x7f]/.test(value)) throw new Fault(422,"keychain_item_invalid","The configured Keychain item holds an unusable value; no alternate credential was selected.");
  return value;
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
      const output = await runVaultCommand(binding,["get",binding.source.key,"--check"],this.env,{}, {
        captureBytes:4096,oversizeCode:"vault_check_failed",oversizeMessage:"The secrets CLI returned an oversized check result.",
      });
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

type VaultOperatorResolution = {environment:NodeJS.ProcessEnv;source:string};

/** Select an operator through the shared credential seam, then pin that choice. */
async function resolveVaultOperatorEnvironment(binding: CredentialBinding, env: NodeJS.ProcessEnv, options: Pick<CredentialChainOptions,"keychain"> = {}): Promise<VaultOperatorResolution> {
  if (binding.source.kind !== "vault") throw new Fault(500,"credential_resolution","Unexpected credential source.");
  const source = binding.source;
  let credential, url = source.url;
  try {
    if (source.operator.kind === "contracts") {
      // Validate the untouched canonical environment first. A binding URL may
      // replace the gateway default, but never a different configured authority.
      const pair = () => {
        const keys = clientTransportEnvKeys("secrets");
        const configuredUrl = keys.apiUrlKeys.map(name=>env[name]).find(value=>value !== undefined)
          ?? keychainConfigValue("secrets",env,options.keychain)?.value
          ?? appConfigDiskValue("secrets",env,keys.apiUrlKeys)?.value;
        const resolution = resolveClientTransport("secrets",env,{credentials:options});
        const key = resolveCredential("secrets",env,options);
        if (key?.tier === "pointer") throw new Fault(422,"vault_operator_pointer","A Secrets operator cannot bootstrap itself through HASNA_SECRETS_API_KEY_REF. Configure its operator in Keychain, canonical config/credentials, or an explicit key override.");
        if (!key?.apiKey || key.source !== resolution.apiKeySource || key.tier !== resolution.apiKeyTier)
          throw new Fault(422,"vault_operator_changed","The vault operator changed during resolution; no credential was sent. Retry after configuration is stable.");
        const boundUrl = source.url ? toV1BaseUrl(source.url) : resolution.baseUrl;
        if (resolution.apiUrlSource !== "default" && boundUrl !== resolution.baseUrl)
          throw new Fault(422,"vault_operator_authority","The binding vault URL conflicts with the canonical Secrets API URL; no credential was sent.");
        if (configuredUrl !== undefined && toV1BaseUrl(configuredUrl) !== resolution.baseUrl)
          throw new Fault(422,"vault_operator_changed","The vault authority changed during resolution; no credential was sent.");
        // Preserve the configured spelling: the child's shared resolver also
        // compares literal authorities, including an explicitly written /v1.
        return {key,url:configuredUrl?.trim() ?? source.url ?? boundUrl.replace(/\/v1$/,"")};
      };
      const first = pair(), second = pair();
      if (first.key.apiKey !== second.key.apiKey || first.key.source !== second.key.source || first.key.tier !== second.key.tier || first.url !== second.url)
        throw new Fault(422,"vault_operator_changed","The vault operator or authority changed during resolution; no credential was sent. Retry after configuration is stable.");
      credential = second.key; url = second.url;
    } else {
      // Legacy bindings deliberately select one exact source. Never reinterpret
      // them as the shared chain or rescue a locked/missing named account.
      credential = source.operator.kind === "keychain"
        ? resolveCredential("secrets",{HASNA_STATION:source.operator.account},{keychain:{...options.keychain,enabled:true}})
        : resolveCredential("secrets",Object.fromEntries(Object.entries(env).filter(([name])=>name==="HASNA_SECRETS_API_KEY")),{keychain:{enabled:false}});
    }
  } catch (error) {
    if (error instanceof Fault) throw error;
    const kind = error instanceof Error ? error.name : "";
    const detail = error instanceof Error ? error.message : "";
    const reason = /keychain|security exited/i.test(detail) ? "selected Secrets Keychain source is locked or inaccessible"
      : kind === "CredentialFileUnsafeError" ? "unsafe canonical config/credentials file"
      : kind === "ClientTransportConfigurationError" ? "invalid or missing canonical API URL/key"
      : source.operator.kind === "keychain" ? "unavailable pinned Keychain account"
      : "credential selection refused by Contracts (Keychain, canonical file, profile, or environment)";
    throw new Fault(422,"vault_operator_unavailable",`Cannot resolve the Secrets vault operator: ${reason}. Check the selected source in this terminal session; no alternate account was selected.`);
  }
  if (!credential?.apiKey) throw new Fault(422,"vault_operator_missing","The selected vault operator has no credential. Use a canonical Contracts binding, restore its named Keychain account, or inject HASNA_SECRETS_API_KEY for an explicit env binding.");
  // Pass only execution/config context, not unrelated fleet/provider credentials or
  // deliberate profile/pointer overrides. The explicit override prevents the
  // Secrets CLI from reselecting an ambient Keychain/disk operator. Its shared URL
  // resolver may still reject a conflicting local authority; that remains terminal.
  const allowed = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z_]+|TMPDIR|TEMP|TMP|HASNA_HOME|HASNA_CONFIG_HOME|HASNA_SECRETS_HOME|HASNA_STATION)$/;
  const next: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(env).filter(([name])=>allowed.test(name)));
  next.HASNA_SECRETS_API_URL = url;
  next.HASNA_SECRETS_API_KEY = credential.apiKey;
  next.HASNA_SECRETS_API_KEY_OVERRIDE = credential.apiKey;
  if (binding.source.operator.kind === "keychain") next.HASNA_STATION = binding.source.operator.account;
  return {environment:next,source:credential.source};
}

/** Select an operator through the shared credential seam, then pin that choice. */
export async function vaultEnvironment(binding: CredentialBinding, env: NodeJS.ProcessEnv, options: Pick<CredentialChainOptions,"keychain"> = {}): Promise<NodeJS.ProcessEnv> {
  return (await resolveVaultOperatorEnvironment(binding,env,options)).environment;
}

/** Vault children never own a harness or a TTY; their entire process group is bounded. */
async function runVaultCommand(binding: CredentialBinding, args: string[], env: NodeJS.ProcessEnv, delivery: NodeJS.ProcessEnv = {}, options: {
  captureBytes?:number;oversizeCode?:string;oversizeMessage?:string;lookupCode?:string;lookupMessage?:string;operator?:VaultOperatorResolution;
} = {}): Promise<string> {
  if (binding.source.kind !== "vault") throw new Fault(500,"credential_resolution","Unexpected credential source.");
  if (process.platform === "win32") throw new Fault(422,"vault_exec_unavailable","Vault CLI bindings currently require POSIX process groups; use runtime environment injection on Windows.");
  const executable = await validateVaultExecutable(binding.source.executable);
  const operator = options.operator ?? await resolveVaultOperatorEnvironment(binding,env);
  const childEnv = {...operator.environment,...delivery};
  return new Promise((resolveResult,reject) => {
    const child = spawn(executable,args,{env:childEnv,stdio:["ignore",options.captureBytes ? "pipe" : "ignore","ignore"],detached:true,shell:false});
    let failure: Fault | undefined;
    let output = "";
    let outputBytes = 0;
    let cleaned = false;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid,"SIGKILL"); } catch {} } };
    const interrupt = (signal: "SIGINT" | "SIGTERM") => { failure = new CredentialInterrupted(signal === "SIGINT" ? 130 : 143); process.exitCode = signal === "SIGINT" ? 130 : 143; kill(); };
    const onInt = () => interrupt("SIGINT"); const onTerm = () => interrupt("SIGTERM");
    process.on("SIGINT",onInt); process.on("SIGTERM",onTerm);
    const timeout = setTimeout(()=>{ failure = new Fault(504,"vault_timeout","Credential lookup exceeded 20 seconds; no alternate credential was selected."); kill(); },20_000);
    const cleanup = () => { if (cleaned) return; cleaned = true; clearTimeout(timeout); process.off("SIGINT",onInt); process.off("SIGTERM",onTerm); kill(); };
    child.stdout?.on("data",(chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > (options.captureBytes ?? 0)) { failure = new Fault(422,options.oversizeCode??"vault_check_failed",options.oversizeMessage??"The secrets CLI returned an oversized result."); kill(); }
      else output += chunk.toString("utf8");
    });
    child.once("error",()=>{ cleanup(); reject(new Fault(422,"vault_exec_failed","The configured secrets CLI could not start; check its executable and permissions.")); });
    child.once("exit",cleanup);
    child.once("close",code=>{
      if (failure) reject(failure);
      else if (code !== 0) reject(new Fault(422,options.lookupCode??"vault_lookup_failed",options.lookupMessage??"The secrets CLI could not read the configured key. Check vault access and conflicting local vault URL settings; no alternate account was selected."));
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

const secretMetadataSchema = z.object({
  key:vaultKey,type:z.enum(["api_key","password","token","credential","other"]),label:z.string().max(1000).nullable().optional(),
  expires_at:z.string().max(200).nullable().optional(),created_at:z.string().max(200),updated_at:z.string().max(200),
}).strict();
export type VaultCredentialReference = {
  account:string;key:string;url?:string;executable:string;
  operator:{kind:"contracts"}|{kind:"env"}|{kind:"keychain";account:string};
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
  return [...entries.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(entry=>({account:operator.source,key:entry.key,executable:vaultExecutable,operator:{kind:"contracts" as const}}));
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
  const authStyle=provider.catalogAuthStyle??provider.authStyle??"bearer";
  const catalogCredentialEnv=provider.catalogCredentialEnv??provider.credentialEnv;
  if(authStyle==="none"||catalogCredentialEnv!==provider.credentialEnv||provider.catalogFormat==="none")return undefined;
  const root=provider.catalogBaseUrl??(provider.catalogFormat==="fireworks"&&provider.catalogAccountId?`https://api.fireworks.ai/v1/accounts/${encodeURIComponent(provider.catalogAccountId)}`:provider.baseUrl);
  const url=new URL(`${root}/${provider.modelsPath??"models"}`);
  if(url.origin!==new URL(provider.baseUrl).origin&&!provider.catalogCredentialEnv)throw new Fault(422,"catalog_credential_authority","A different catalog origin requires an explicit catalog credential reference.");
  if(provider.catalogFormat==="fireworks")url.searchParams.set("pageSize","1");
  return {url,method:"GET",authStyle};
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
    await resolver.bindings.bind(parse(credentialBindingSchema,{schema:1,credentialEnv:provider.credentialEnv,origins:credentialOrigins(provider),source}));
    configured=true;credential=await resolver.resolve(provider);
    if(!credential)throw new Fault(422,"vault_delivery_failed","The selected credential reference did not provide a usable value; no alternate account was selected.");
  }
  const verify=options.verifyProviderAuthentication??(request=>verifyProviderAuthentication(request));
  const result=await verify({provider,credential});
  if(result.unsupported){
    if(configured)throw new Fault(422,"provider_auth_check_unsupported","This provider has no configured non-inference authentication check. The selected binding was preserved; configure credentialCheck or verify it explicitly before launch.");
    return preparedProviderCredential(provider,credential,{source:existing?"binding":"environment",configured,verified:false});
  }
  if(!result.authenticated)throw new Fault(401,"provider_credential_rejected",`The provider rejected the selected credential${result.status?` with HTTP ${result.status}`:""}. No alternate account was selected.${configured?` To choose a different reference, run: switcher credentials remove ${provider.credentialEnv}.`:""}`);
  return preparedProviderCredential(provider,credential,{source:existing||configured?"binding":"environment",configured,verified:true});
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
