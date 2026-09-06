import { assertHarnessArguments } from "./harness-arguments";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SwitcherClient } from "./sdk";
import { codingEligible, type LaunchPlan, type ProviderInput } from "./domain";
import { providerCredential } from "./presets";
import { privateDirectory, switcherHome } from "./runtime";
import { prepareHarnessLaunch, detectHarness, codexModel, validateHarnessVersion } from "./harnesses";
import { runHarnessProcess } from "./harness-process";
import { oriLaunchWarnings, assertOriLoginAllowed, inspectOri, prepareOriLaunch, requireOriHarness, validateOriLaunchRequest, type OriContract, type OriLaunchPlan } from "./ori-backend";

import { childEnvironment } from "./harness-environment";
export { childEnvironment } from "./harness-environment";
export type LaunchBackend = "direct" | "ori";
export type LaunchOptions = {backend?: LaunchBackend; oriExecutable?: string; cwd?: string; executable?: string; stateDir?: string; args?: string[]; timeoutMs?: number; refresh?: boolean; credentialEnv?: NodeJS.ProcessEnv; resolveCredential?: (provider: ProviderInput)=>Promise<string | undefined>};

async function writeOriCodexCatalog(stateDir: string, models: LaunchPlan["catalog"]["models"]): Promise<string> {
  const path = join(stateDir, "ori-codex-models.json");
  const nativeModels = models.filter(codingEligible).map(codexModel);
  await writeFile(path, JSON.stringify({models: nativeModels}, null, 2) + "\n", {mode: 0o600, flag: "wx"});
  return path;
}

type OriPreparationOptions = Pick<LaunchOptions, "oriExecutable" | "args" | "resolveCredential" | "credentialEnv"> & {stateDir?: string; cwd?: string};

async function oriRequestForPlan(plan: LaunchPlan, options: OriPreparationOptions = {}) {
  if (options.oriExecutable === "") throw new Error("--ori-executable requires a non-empty executable path.");
  if (plan.provider.authStyle !== "bearer") throw new Error("Ori requires the OpenRouter Bearer authentication contract; use the direct adapter for other auth styles.");
  assertOriLoginAllowed({...process.env, ...options.credentialEnv});
  const policyEnvironment = {...process.env, ...options.credentialEnv};
  if (plan.profile.harness === "grok" && !["", "0", "false", "no", "off"].includes((policyEnvironment.GROK_DISABLE_API_KEY_AUTH ?? "").trim().toLowerCase()))
    throw new Error("Grok API-key authentication is disabled by GROK_DISABLE_API_KEY_AUTH. This provider launch cannot proceed under that native authentication policy.");
  if (plan.profile.harness === "grok" && policyEnvironment.GROK_FORCE_LOGIN_TEAM_ID?.trim())
    throw new Error("Grok requires a native team login through GROK_FORCE_LOGIN_TEAM_ID. This provider launch cannot proceed under that native authentication policy.");
  const contract = await inspectOri({executable: options.oriExecutable, cwd: options.cwd ? resolve(options.cwd) : undefined});
  const native = requireOriHarness(contract, plan.profile.harness);
  if (!native.path) throw new Error("Ori did not report the native harness executable path.");
  const detection = await detectHarness(plan.profile.harness, native.path);
  if (!detection.available) throw new Error("The native harness reported by Ori could not report its version.");
  validateHarnessVersion(plan.profile.harness, detection.version);
  const catalogPath = plan.profile.harness === "codex" && options.stateDir ? await writeOriCodexCatalog(options.stateDir, plan.catalog.models) : undefined;
  const request = buildOriRequest(plan, catalogPath, options.args ?? []);
  validateOriLaunchRequest(request);
  return {contract, request};
}

export async function validateOriForPlan(plan: LaunchPlan, options: Pick<OriPreparationOptions, "oriExecutable" | "args" | "credentialEnv" | "cwd"> = {}): Promise<{contract: OriContract; request: ReturnType<typeof buildOriRequest>; warnings: string[]}> {
  return {...await oriRequestForPlan(plan, options),warnings:oriLaunchWarnings(plan.profile.harness)};
}

function buildOriRequest(plan: LaunchPlan, catalogPath: string | undefined, args: string[]) {
  return {
    target: plan.profile.harness, provider: plan.provider.id, providerBaseUrl: plan.provider.baseUrl,
    protocol: plan.provider.protocol, model: plan.profile.model,
    catalog: {source: "switcher-openrouter" as const, modelIds: plan.catalog.models.filter(codingEligible).map(model => model.id), ...(catalogPath ? {codexModelCatalogPath: catalogPath} : {})}, args,
  } as const;
}

export async function prepareOriForPlan(plan: LaunchPlan, options: OriPreparationOptions = {}): Promise<{contract: OriContract; prepared: OriLaunchPlan}> {
  const {contract, request} = await oriRequestForPlan(plan, options);
  // Provider authority, login policy and unsupported target checks run before
  // this resolver call. A key is only placed in the child environment later.
  const credential = options.resolveCredential ? await options.resolveCredential(plan.provider) : providerCredential(plan.provider, options.credentialEnv);
  if (!credential) throw new Error("OpenRouter credential is required for an Ori launch; configure a Switcher credential binding.");
  const prepared = prepareOriLaunch({...request, executable: contract.executable, environment: {...process.env, ...options.credentialEnv, OPENROUTER_API_KEY: credential}});
  return {contract, prepared};
}

export async function launch(client: SwitcherClient, profileId: string, options: LaunchOptions = {}): Promise<number> {
  const profile = await client.getProfile(profileId);
  assertHarnessArguments(profile.harness,options.args ?? []);
  // Respect Grok's deployment lockdown. Silently dropping this setting could
  // bypass policy; inheriting it without checking can switch to native login.
  if (profile.harness === "grok" && !["","0","false","no","off"].includes((process.env.GROK_DISABLE_API_KEY_AUTH ?? "").trim().toLowerCase()))
    throw new Error("Grok API-key authentication is disabled by GROK_DISABLE_API_KEY_AUTH. This provider launch cannot proceed under that native authentication policy.");
  if (profile.harness === "grok" && process.env.GROK_FORCE_LOGIN_TEAM_ID?.trim())
    throw new Error("Grok requires a native team login through GROK_FORCE_LOGIN_TEAM_ID. This provider launch cannot proceed under that native authentication policy.");
  // A fresh snapshot is required for each launch. Errors remain visible.
  if (options.refresh !== false) await client.refreshModels(profile.providerId);
  const plan = await client.launchPlan(profileId);
  assertHarnessArguments(plan.profile.harness,options.args ?? []);
  const backend = options.backend ?? "direct";
  if (backend !== "direct" && backend !== "ori") throw new Error("Unknown launch backend; use direct or ori.");
  if (backend === "ori" && options.executable) throw new Error("--executable is ambiguous with --backend ori; use --ori-executable PATH.");
  if (backend === "direct" && options.oriExecutable) throw new Error("--ori-executable requires --backend ori.");
  const detection = backend === "direct" ? await detectHarness(plan.profile.harness, options.executable) : undefined;
  if (backend === "direct" && !detection?.available) throw new Error(`Harness ${plan.profile.harness} is not installed; use --executable PATH after installing it.`);
  const root = resolve(options.stateDir ?? join(switcherHome(),"state"));
  await privateDirectory(root);
  const stateDir = await mkdtemp(join(root,"launch-"));
  let credential: string | undefined;
  let ori: Awaited<ReturnType<typeof prepareOriForPlan>> | undefined;
  if (backend === "ori") {
    try { ori = await prepareOriForPlan(plan, {...options, stateDir}); }
    catch (error) { await rm(stateDir, {recursive: true, force: true}); throw error; }
    credential = ori.prepared.env.OPENROUTER_API_KEY;
  } else {
    try {
      credential = options.resolveCredential ? await options.resolveCredential(plan.provider) : providerCredential(plan.provider, options.credentialEnv);
      if (plan.provider.credentialEnv && !credential) throw new Error("Provider credential environment reference is not available in this local launcher process.");
    } catch (error) { await rm(stateDir, {recursive: true, force: true}); throw error; }
  }
  let run: Awaited<ReturnType<SwitcherClient["createRun"]>> | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const prepared = ori?.prepared ? {...ori.prepared, configPaths: []} : await prepareHarnessLaunch({
      harness:plan.profile.harness, baseUrl:plan.provider.baseUrl, protocol:plan.provider.protocol,
      model:plan.profile.model, models:plan.catalog.models.filter(codingEligible),
      credential, authStyle:plan.provider.authStyle, executable:options.executable, args:options.args ?? [], stateDir,
      cwd:resolve(options.cwd ?? process.cwd()), version:detection?.version,
      ...(plan.profile.harness === "pi" ? {sessionDir:join(root,"sessions","pi",profileId)} : {}),
    });
    cleanup = prepared.cleanup;
    for (const warning of [...plan.warnings,...prepared.warnings]) console.error(`switcher: ${warning}`);
    run = await client.createRun({profileId,model:plan.profile.model,harness:plan.profile.harness,planToken:plan.planToken});
    const {code,interrupted} = await runHarnessProcess({executable:prepared.executable,args:prepared.args,cwd:resolve(options.cwd ?? process.cwd()),env:{...childEnvironment(),...prepared.env},timeoutMs:options.timeoutMs});
    await client.finishRun(run.id,run.version,{status:interrupted?"interrupted":code===0?"exited":"failed",exitCode:code},crypto.randomUUID())
      .catch(() => console.error(`switcher: Harness exited ${code}; final metadata could not be saved for run ${run!.id}.`));
    return code;
  } catch (error) {
    if (run) await client.finishRun(run.id,run.version,{status:"failed",exitCode:1}).catch(() => console.error("switcher: Could not persist final run status; inspect the run through the API."));
    throw error;
  } finally {
    try { await cleanup?.(); }
    finally { await rm(stateDir,{recursive:true,force:true}); }
  }
}
