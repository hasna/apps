import { spawn } from "node:child_process";
import { PassThrough, Transform } from "node:stream";
import { once } from "node:events";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { codexConfigGuard, codexDirectoryGuard, codexFileGuard, inspectCodexNative } from "./codex-native";
import { settleHarnessGroup } from "./harness-process";
import { assertHarnessArguments, codexCommandIndex, codexConfigPath, codexOptionRequestsHelp, codexOptionTakesValue } from "./harness-arguments";
import { codexRoutingKeys, codexTransportKeys } from "./codex-model-policy";
import { createHash } from "node:crypto";
import { assertCodexCanonicalLaunch, resolveNativeState, type NativeState } from "./native-state";
import { childEnvironment } from "./harness-environment";
import { Fault } from "./domain";

const MAX_FRAME = 8 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const decoder = new TextDecoder("utf-8",{fatal:true});
const credentialKeys = new Set(["env_key","env_http_headers","http_headers","auth_command"]);
const routingAliases = new Set(["modelProvider","modelProviders","modelCatalogJson","reviewModel","modelId","providerId","providers","baseUrl","baseURL","wireApi","wireAPI","requires_openai_auth","requiresOpenaiAuth","requiresOpenAIAuth"]);
const credentialAliases = new Set(["envKey","envHttpHeaders","httpHeaders","httpHeader","header","headers","authCommand","auth","authorization","Authorization","api_key","apiKey","api-key","x-api-key"]);
const stateOwnedKeys = new Set(["review_model","sqlite_home","config_file","extract_model","consolidation_model","sqliteHome","configFile","extractModel","consolidationModel"]);
const agentOwnedKeys = new Set(["default_subagent_model","default_subagent_reasoning_effort","default_subagent_reasoning_summary","defaultSubagentModel","defaultSubagentReasoningEffort","defaultSubagentReasoningSummary"]);
const prototypeKeys = new Set(["__proto__","prototype","constructor"]);
const forbiddenKeys = new Set([...codexTransportKeys,...credentialKeys,...credentialAliases,"plugin","mcpServer","mcpServers","profile","profiles","include","auth_home","authHome","cli_auth_credentials_store","cliAuthCredentialsStore",...prototypeKeys]);
const ownedKeys = new Set([...codexRoutingKeys,...routingAliases,...stateOwnedKeys,...agentOwnedKeys]);
const unsafeKeys = new Set([...forbiddenKeys,...ownedKeys]);
const managedParamKeys = new Set(["config","model","modelProvider","modelProviders","allowProviderModelFallback"]);
const unsafeParamKeys = new Set([...forbiddenKeys,...ownedKeys,...managedParamKeys,"provider","plugins"]);
function configKeySegments(key:string):string[]{
  const parts=codexConfigPath(key).flatMap(part=>part.split(".")).filter(Boolean);
  if(!parts.length)throw new Error("codex_state_config_key");return parts;
}
function securityKeySegments(key:string):string[]{
  try{return configKeySegments(key);}catch{return key.match(/[A-Za-z_][A-Za-z0-9_]*/g)??[];}
}
function safePath(value:unknown):value is string{if(typeof value!=="string"||!value.startsWith("/")||/[\r\n\0]/.test(value))return false;const parts=value.split("/").slice(1);return parts.length>0&&parts.every(part=>part!==""&&part!=="."&&part!=="..");}
function merge(base:ObjectValue,overlay:ObjectValue):ObjectValue{
  const result={...base};for(const[key,value]of Object.entries(overlay))result[key]=object(value)&&object(result[key])?merge(result[key] as ObjectValue,value):value;return result;
}
function sanitizeOwnedTree(value:unknown,additionalOwned:Set<string>,path:string):unknown{
  if(Array.isArray(value))return value.map((item,index)=>sanitizeOwnedTree(item,additionalOwned,`${path}[${index}]`));
  if(!object(value))return value;
  const result:ObjectValue={};
  for(const[key,item]of Object.entries(value)){
    const segments=securityKeySegments(key);
    if(segments.some(part=>forbiddenKeys.has(part)))throw new Error(`codex_state_unsafe_config:${path}.${key}`);
    if(segments.some(part=>ownedKeys.has(part)||additionalOwned.has(part)))continue;
    result[key]=sanitizeOwnedTree(item,additionalOwned,`${path}.${key}`);
  }
  return result;
}
function safeAgents(value:unknown):unknown{
  if(!object(value))throw new Error("codex_state_agents");
  const result:ObjectValue={};
  for(const[name,item]of Object.entries(value)){
    if(prototypeKeys.has(name))throw new Error(`codex_state_unsafe_config:agents.${name}`);
    if(agentOwnedKeys.has(name))continue;
    if(object(item)){result[name]=sanitizeOwnedTree(item,new Set(),`agents.${name}`);continue;}
    if(securityKeySegments(name).some(part=>unsafeKeys.has(part)))throw new Error(`codex_state_unsafe_config:agents.${name}`);
    result[name]=item;
  }
  return result;
}
function safeMemories(value:unknown):unknown{
  if(!object(value))throw new Error("codex_state_memories");
  return sanitizeOwnedTree(value,new Set(),"memories");
}
function validateRouting(routing:CodexStateRouting):void{
  if(typeof routing.model!=="string"||!routing.model||routing.model.length>4096||/[\r\n\0]/.test(routing.model))throw new Error("codex_state_routing");
  const allowed=new Set(["model_provider","model_providers","model_catalog_json","review_model","agents","memories","sqlite_home"]);
  if(Object.keys(routing.config).some(key=>!allowed.has(key))||routing.config.model_provider!=="switcher")throw new Error("codex_state_routing");
  const providers=routing.config.model_providers;if(!object(providers)||Object.keys(providers).length!==1||!object(providers.switcher))throw new Error("codex_state_routing");
  const provider=providers.switcher as ObjectValue,providerKeys=new Set(["name","base_url","wire_api","requires_openai_auth","env_key","env_http_headers"]);
  if(Object.keys(provider).some(key=>!providerKeys.has(key))||provider.name!=="Switcher"||provider.wire_api!=="responses"||provider.requires_openai_auth!==false)throw new Error("codex_state_routing");
  const url=new URL(String(provider.base_url));if(url.protocol!=="http:"||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.port||url.pathname!=="/v1"||url.username||url.password||url.search||url.hash)throw new Error("codex_state_routing");
  if(provider.env_key!==undefined&&provider.env_key!=="SWITCHER_HARNESS_API_KEY")throw new Error("codex_state_routing");
  if(provider.env_http_headers!==undefined){if(!object(provider.env_http_headers)||Object.keys(provider.env_http_headers).length!==1||Object.keys(provider.env_http_headers).some(key=>!["x-api-key","api-key"].includes(key))||Object.values(provider.env_http_headers).some(value=>value!=="SWITCHER_HARNESS_API_KEY"))throw new Error("codex_state_routing");}
  if((provider.env_key===undefined)===(provider.env_http_headers===undefined))throw new Error("codex_state_routing");
  for(const key of ["model_catalog_json","sqlite_home"])if(!safePath(routing.config[key]))throw new Error("codex_state_routing");
  if(routing.config.review_model!==undefined&&(typeof routing.config.review_model!=="string"||/[\r\n\0]/.test(routing.config.review_model)))throw new Error("codex_state_routing");
  if(routing.config.agents!==undefined){
    const agents=routing.config.agents;if(!object(agents))throw new Error("codex_state_routing");
    for(const [name,item] of Object.entries(agents)){
      if(prototypeKeys.has(name))throw new Error("codex_state_routing");
      if(name==="default_subagent_model"){if(typeof item!=="string"||/[\r\n\0]/.test(item))throw new Error("codex_state_routing");continue;}
      if(!object(item)){assertSafeRetained({[name]:item},"routing.agents");continue;}
      const copy=structuredClone(item);
      if(copy.config_file!==undefined){if(!safePath(copy.config_file))throw new Error("codex_state_routing");delete copy.config_file;}
      assertSafeRetained(copy,`routing.agents.${name}`);
    }
  }
  if(routing.config.memories!==undefined){
    if(!object(routing.config.memories))throw new Error("codex_state_routing");
    const memories=structuredClone(routing.config.memories);
    for(const key of ["extract_model","consolidation_model"]){if(memories[key]!==undefined&&(typeof memories[key]!=="string"||/[\r\n\0]/.test(memories[key])))throw new Error("codex_state_routing");delete memories[key];}
    assertSafeRetained(memories,"routing.memories");
  }
}
function assertSafeRetained(value: unknown, path = "config"): void {
  if (Array.isArray(value)) { value.forEach((item,index)=>assertSafeRetained(item,`${path}[${index}]`));return; }
  if (!object(value)) return;
  for (const [key,item] of Object.entries(value)) {
    if(securityKeySegments(key).some(part=>unsafeKeys.has(part)))throw new Error(`codex_state_unsafe_config:${path}.${key}`);
    assertSafeRetained(item,`${path}.${key}`);
  }
}
function safeManagedParams(params:ObjectValue):ObjectValue{
  const safe:ObjectValue={};
  for(const [key,value]of Object.entries(params)){
    if(managedParamKeys.has(key))continue;
    if(securityKeySegments(key).some(part=>unsafeParamKeys.has(part)))throw new Error("codex_state_param_override");
    safe[key]=value;
  }
  return safe;
}
export type CodexStateRouting = { model: string; config: ObjectValue };

/** Supported native RPC only: catalog read-repair and current launch routing.
 * Thread IDs, histories, tool calls, permissions and response bytes are intact. */
export function rewriteCodexStateRequest(line: Buffer, routing: CodexStateRouting): Buffer {
  validateRouting(routing);if (line.length > MAX_FRAME) throw new Error("codex_state_frame_limit");
  const request: unknown = JSON.parse(decoder.decode(line));
  if (!object(request)) throw new Error("codex_state_protocol");
  const managed=["thread/list","thread/start","thread/resume","thread/fork"].includes(String(request.method));
  if(managed&&!Object.hasOwn(request,"id"))throw new Error("codex_state_protocol");
  if(!managed)return line;
  if (request.params != null && !object(request.params)) throw new Error("codex_state_protocol");
  const params = (request.params ?? {}) as ObjectValue,safeParams=safeManagedParams(params);
  if (request.method === "thread/list") {
    request.params = { ...safeParams, modelProviders: [], useStateDbOnly: false };
  } else {
    if (params.config != null && !object(params.config)) throw new Error("codex_state_protocol");
    const retained: ObjectValue = {};
    for(const [key,value] of Object.entries(params.config ?? {})) {
      const path=configKeySegments(key),root=path[0];
      if(path.some(item=>forbiddenKeys.has(item)))throw new Error("codex_state_transport_override");
      if(path.some(item=>ownedKeys.has(item)))continue;
      if((root==="agents"||root==="memories")&&path.length>1)throw new Error("codex_state_config_ambiguous");
      if(root==="agents"){if(Object.hasOwn(retained,root))throw new Error("codex_state_config_ambiguous");retained[root]=safeAgents(value);}
      else if(root==="memories"){if(Object.hasOwn(retained,root))throw new Error("codex_state_config_ambiguous");retained[root]=safeMemories(value);}
      else {assertSafeRetained({[key]:value});retained[key]=value;}
    }
    request.params = { ...safeParams, modelProvider: "switcher", model: routing.model,
      ...(request.method === "thread/start" ? { allowProviderModelFallback: false } : {}),
      config: merge(retained,routing.config) };
  }
  return Buffer.from(JSON.stringify(request));
}

export function codexStateRequestStream(routing: CodexStateRouting): Transform {
  let pending = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const joined = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let start = 0, end: number;
        while ((end = joined.indexOf(10, start)) >= 0) {
          const line = joined.subarray(start, end);
          if (line.length) this.push(Buffer.concat([rewriteCodexStateRequest(line, routing), Buffer.from("\n")]));
          start = end + 1;
        }
        pending = Buffer.from(joined.subarray(start));
        if (pending.length > MAX_FRAME) throw new Error("codex_state_frame_limit");
        callback();
      } catch { callback(new Error("codex_state_protocol")); }
    },
    flush(callback) { callback(pending.length ? new Error("codex_state_truncated_frame") : undefined); },
  });
}

export type CodexDesktopSnapshot = {
  home: string; sqliteHome: string; homeIdentity: string; sqliteIdentity: string;
  configIdentity: string | null; configSha256: string | null;
};
export type CodexDesktopBinding = {
  schema: 1; nativeExecutable: string; canonical: CodexDesktopSnapshot;
  authHome: string; authIdentity: string; authSha256: string;
  sessionDir: string; settlementDirectory: string; args: string[];
};
const desktopRefusal = () => new Fault(409, "desktop_binding_changed", "The desktop native binding changed or is unsupported. Existing state was preserved; prepare a new launch.");
const identity = async (path: string) => {
  const entry = await lstat(path, { bigint: true });
  return [entry.dev, entry.ino, entry.uid, entry.gid, entry.mode].join(":");
};

/** Legacy private corpus/config must be reconciled explicitly, never hidden by
 * redirecting a new desktop process to the canonical native home. */
export async function assertChatGPTLegacyEmpty(sessionDir: string): Promise<void> {
  const legacy = join(sessionDir, "codex");
  try { await lstat(legacy); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  await (await codexDirectoryGuard(legacy, true))();
  if ((await readdir(legacy)).length)
    throw new Fault(409, "native_state_migration_required", "This desktop profile retains a private Codex corpus or configuration. Reconcile its original state before launching with shared state; no files were changed.");
}

export async function snapshotCodexDesktopState(state: NativeState): Promise<CodexDesktopSnapshot> {
  if (state.tool !== "codex" || !state.sqliteHome) throw desktopRefusal();
  await (await codexDirectoryGuard(state.home))();
  await (await codexDirectoryGuard(state.sqliteHome))();
  await assertCodexCanonicalLaunch(state);
  const guard = await codexConfigGuard(state.home), path = join(state.home, "config.toml");
  let configIdentity: string | null = null, configSha256: string | null = null;
  try {
    configIdentity = await identity(path);
    configSha256 = createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await guard();
  return { home: state.home, sqliteHome: state.sqliteHome, homeIdentity: await identity(state.home), sqliteIdentity: await identity(state.sqliteHome), configIdentity, configSha256 };
}

export async function assertCodexDesktopSnapshot(expected: CodexDesktopSnapshot): Promise<void> {
  const state = await resolveNativeState("codex", { HASNA_CODEX_STATE_HOME: expected.home }, { create: false });
  if (JSON.stringify(await snapshotCodexDesktopState(state)) !== JSON.stringify(expected)) throw desktopRefusal();
}

/** Public for protocol fixtures; installation selection always remains pinned. */
export async function runCodexDesktopHelper(bindingPath: string, bindingSha256: string, args: string[]): Promise<number> {
  if (!/^[a-f0-9]{64}$/.test(bindingSha256)) throw desktopRefusal();
  const guardBinding = await codexFileGuard(bindingPath, 1024 * 1024, bindingSha256);
  const raw: unknown = JSON.parse(await readFile(bindingPath, "utf8"));
  const keys = ["schema", "nativeExecutable", "canonical", "authHome", "authIdentity", "authSha256", "sessionDir", "settlementDirectory", "args"];
  if (!object(raw) || Object.keys(raw).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(raw, key))
      || raw.schema !== 1 || !object(raw.canonical) || !Array.isArray(raw.args) || raw.args.some(arg => typeof arg !== "string")
      || ![raw.nativeExecutable, raw.authHome, raw.sessionDir, raw.settlementDirectory].every(safePath)
      || typeof raw.authIdentity !== "string" || typeof raw.authSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.authSha256)) throw desktopRefusal();
  const canonical = raw.canonical;
  const canonicalKeys = ["home", "sqliteHome", "homeIdentity", "sqliteIdentity", "configIdentity", "configSha256"];
  if (Object.keys(canonical).some(key => !canonicalKeys.includes(key)) || canonicalKeys.some(key => !Object.hasOwn(canonical, key))
      || !safePath(raw.canonical.home) || !safePath(raw.canonical.sqliteHome)
      || ![raw.canonical.homeIdentity, raw.canonical.sqliteIdentity].every(value => typeof value === "string")
      || !(raw.canonical.configIdentity === null || typeof raw.canonical.configIdentity === "string")
      || !(raw.canonical.configSha256 === null || typeof raw.canonical.configSha256 === "string" && /^[a-f0-9]{64}$/.test(raw.canonical.configSha256))) throw desktopRefusal();
  const binding = raw as unknown as CodexDesktopBinding;
  if (binding.authHome !== join(bindingPath.slice(0, bindingPath.lastIndexOf("/")), "auth")
      || binding.settlementDirectory !== join(binding.sessionDir, "codex-bridges")) throw desktopRefusal();
  await guardBinding();
  const native = await inspectCodexNative(binding.nativeExecutable);
  const guardAuth = await codexDirectoryGuard(binding.authHome, true);
  const check = async () => {
    await guardBinding(); await native.guard(); await guardAuth();
    await assertCodexDesktopSnapshot(binding.canonical); await assertChatGPTLegacyEmpty(binding.sessionDir);
    if (await identity(binding.authHome) !== binding.authIdentity) throw desktopRefusal();
    const names = await readdir(binding.authHome);
    if (names.length !== 1 || names[0] !== "auth.json") throw desktopRefusal();
    await (await codexFileGuard(join(binding.authHome, "auth.json"), 64 * 1024, binding.authSha256))();
  };
  assertHarnessArguments("codex", args, { additionalReserved: ["--listen"] });
  const command = codexCommandIndex(args), mode = command < 0 ? undefined : args[command];
  let help = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") break;
    if (codexOptionRequestsHelp(args[i])) help = true;
    if (codexOptionTakesValue(args[i])) i++;
  }
  if (mode !== "app-server" && mode !== "sandbox" && !(mode === undefined && help)) throw desktopRefusal();
  if (mode === "app-server") {
    const nested = codexCommandIndex(args.slice(command + 1));
    if (nested >= 0) throw desktopRefusal();
  }
  let config: ObjectValue = {};
  for (let i = 0; i < binding.args.length; i += 2) {
    if (binding.args[i] !== "-c" || typeof binding.args[i + 1] !== "string") throw desktopRefusal();
    config = merge(config, Bun.TOML.parse(binding.args[i + 1]) as ObjectValue);
  }
  const routing: CodexStateRouting = { model: String(config.model ?? ""), config: Object.fromEntries(Object.entries(config).filter(([key]) => ["model_provider", "model_providers", "model_catalog_json", "review_model", "agents", "memories", "sqlite_home"].includes(key))) };
  validateRouting(routing);
  const appServer = mode === "app-server" && !help;
  // The desktop runtime needs its local tool pipes and bundled executables.
  // Do not inherit arbitrary CODEX_* routing or account credentials.
  const runtimeEnvironment = new Set(["CODEX_CLI_PATH", "CODEX_APP_TOOLS_PIPE_PATH", "CODEX_BROWSER_USE_NODE_PATH",
    "CODEX_BROWSER_USE_PEER_AUTHORIZATION", "CODEX_MCP_NODE_PATH", "CODEX_NODE_REPL_PATH",
    "CODEX_ELECTRON_COMPUTER_USE_APP_PATH", "CODEX_ELECTRON_BUNDLED_PLUGINS_RESOURCES_PATH"]);
  const appEnvironment = !help ? Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined
    && runtimeEnvironment.has(name))) : {};
  const environment = { ...childEnvironment(), ...appEnvironment, CODEX_HOME: binding.canonical.home, CODEX_SQLITE_HOME: binding.canonical.sqliteHome,
    HASNA_CODEX_STATE_HOME: binding.canonical.home, SWITCHER_HARNESS_API_KEY: appServer ? process.env.SWITCHER_HARNESS_API_KEY ?? "" : "switcher-metadata-no-auth" };
  if (appServer && !environment.SWITCHER_HARNESS_API_KEY) throw desktopRefusal();
  // Sandbox and metadata argv remain exact. Only app-server receives the typed
  // credential home and Switcher's current inference settings.
  const nativeArgs = appServer ? ["--auth-home", binding.authHome, "-c", 'cli_auth_credentials_store="file"', ...args, ...binding.args] : args;
  return runCodexStateBridge(native.executable, nativeArgs, routing, binding.settlementDirectory, { passthrough: !appServer, environment, beforeSpawn: check });
}

/** The native app-server owns inference and state. This process only adapts
 * requests over its supported stdio API, with no retry or conversation replay. */
export async function runCodexStateBridge(executable: string, args: string[], routing: CodexStateRouting, settlementDirectory?: string, execution: { passthrough?: boolean; environment?: NodeJS.ProcessEnv; beforeSpawn?: () => Promise<void> } = {}): Promise<number> {
  validateRouting(routing);
  let clearReceipt = async () => {};
  if (settlementDirectory !== undefined) {
    // The desktop adapter owns this persistent directory. A pending receipt
    // survives bridge crashes and is removed only after native settlement.
    const guardDirectory = await codexDirectoryGuard(settlementDirectory, true);
    const path = join(settlementDirectory, `${crypto.randomUUID()}.pending`);
    await guardDirectory();
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify({ schema: 1, bridgePid: process.pid }) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    const guardReceipt = await codexFileGuard(path, 4096);
    clearReceipt = async () => { await guardDirectory(); await guardReceipt(); await unlink(path); };
  }
  const grouped = process.platform !== "win32";
  let child: ReturnType<typeof spawn>;
  try { await execution.beforeSpawn?.(); child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], detached: grouped, env: execution.environment }); }
  catch (error) { try { await clearReceipt(); } catch { /* Retained receipt fences parent cleanup. */ } throw error; }
  // Own both output pipes: an escaped native descendant must never retain the
  // bridge's actual stdout/stderr descriptors after the bridge itself exits.
  const stdin = child.stdin!, stdout = child.stdout!, stderr = child.stderr!;
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  const requests = execution.passthrough ? new PassThrough() : codexStateRequestStream(routing);
  let stopping = false, failed = false, settled = false, timer: ReturnType<typeof setTimeout> | undefined;
  const signal = (value: NodeJS.Signals) => {
    try { if (grouped && child.pid) process.kill(-child.pid, value); else child.kill(value); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") failed = true; }
  };
  const groupExists = () => {
    if (!child.pid) return false;
    if (!grouped) return child.exitCode === null && child.signalCode === null;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  };
  const stop = () => {
    if (stopping) return; stopping = true;
    stdin.destroy(); signal("SIGTERM");
    timer = setTimeout(() => signal("SIGKILL"), 5000); timer.unref();
  };
  const fail = () => { failed = true; stop(); };
  child.on("error", fail); stdin.on("error", fail); requests.on("error", fail);
  process.stdout.on("error", fail); process.stderr.on("error", fail);
  process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
  const endInput = () => { timer ??= setTimeout(stop, 5000); timer.unref(); };
  process.stdin.once("end", endInput);
  process.stdin.pipe(requests).pipe(stdin);
  stdout.pipe(process.stdout, { end: false }); stderr.pipe(process.stderr, { end: false });
  let code: number | null | undefined;
  // The leader's exit must trigger group cleanup even when a descendant still
  // holds inherited pipes. Missing close is uncertainty, not proof of exit.
  try { [code] = await once(child, "exit") as [number | null]; }
  catch { failed = true; }
  finally {
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await settleHarnessGroup({ exists: groupExists, signal }, 1000);
      if (timer) clearTimeout(timer);
      settled = await Promise.race([closed.then(() => true), new Promise<false>(resolve => {
        closeTimer = setTimeout(() => resolve(false), 5000);
      })]);
      if (!settled) failed = true;
    } catch { failed = true; }
    finally {
      stopping = true;
      if (timer) clearTimeout(timer); if (closeTimer) clearTimeout(closeTimer);
      process.stdin.unpipe(requests); requests.destroy();
      stdout.unpipe(process.stdout); stderr.unpipe(process.stderr);
      stdin.destroy(); stdout.destroy(); stderr.destroy(); process.stdin.pause();
      process.stdin.off("end", endInput); process.stdout.off("error", fail); process.stderr.off("error", fail);
      process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop);
    }
    if (settled) { try { await clearReceipt(); } catch { failed = true; } }
  }
  return failed ? 1 : typeof code === "number" ? code : 1;
}

if (import.meta.main) {
  try {
    const input = process.argv.slice(2);
    if (input[0] === "--desktop") {
      const [, binding, sha256, separator, ...args] = input;
      if (separator !== "--") throw desktopRefusal();
      process.exitCode = await runCodexDesktopHelper(binding, sha256, args);
    } else {
      const settlementDirectory = input[0] === "--settlement-dir" ? input.splice(0, 2)[1] : undefined;
      const [executable, model, config, ...args] = input;
      const parsed: unknown = JSON.parse(config);
      if (!executable?.startsWith("/") || !model || !object(parsed) || args[0] !== "app-server") throw new Error();
      process.exitCode = await runCodexStateBridge(executable, args, { model, config: parsed }, settlementDirectory);
    }
  } catch { console.error("Switcher native session bridge failed."); process.exitCode = 1; }
}
