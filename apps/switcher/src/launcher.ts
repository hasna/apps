import { assertHarnessArguments } from "./harness-arguments";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SwitcherClient } from "./sdk";
import { CommandInterrupted, codingEligible, harnessEligible, validateHarnessProvider, type LaunchPlan, type ProviderInput } from "./domain";
import { providerCredential } from "./presets";
import { privateDirectory, switcherHome } from "./runtime";
import { prepareHarnessLaunch, detectHarness, codexModel, validateHarnessVersion, validateHarnessConfiguration } from "./harnesses";
import { harnessInstallationMessage } from "./harness-installation";
import { runHarnessProcess } from "./harness-process";
import { oriLaunchWarnings, assertOriLoginAllowed, inspectOri, prepareOriLaunch, requireOriHarness, validateOriLaunchRequest, type OriContract, type OriLaunchPlan } from "./ori-backend";

import { childEnvironment } from "./harness-environment";
export { childEnvironment } from "./harness-environment";
export type LaunchBackend = "direct" | "ori";
export type LaunchOptions = {backend?: LaunchBackend; oriExecutable?: string; cwd?: string; executable?: string; stateDir?: string; args?: string[]; timeoutMs?: number; refresh?: boolean; credentialEnv?: NodeJS.ProcessEnv; resolveCredential?: (provider: ProviderInput)=>Promise<string | undefined>};
const LATE_RUN_FINALIZATION_TIMEOUT_MS = 5_000;

async function writeOriCodexCatalog(stateDir: string, models: LaunchPlan["catalog"]["models"]): Promise<string> {
  const path = join(stateDir, "ori-codex-models.json");
  const nativeModels = models.filter(codingEligible).map(codexModel);
  await writeFile(path, JSON.stringify({models: nativeModels}, null, 2) + "\n", {mode: 0o600, flag: "wx"});
  return path;
}

type OriPreparationOptions = Pick<LaunchOptions, "oriExecutable" | "args" | "resolveCredential" | "credentialEnv"> & {stateDir?: string; cwd?: string};
type OriSupportedHarness = Exclude<LaunchPlan["profile"]["harness"], "omp" | "cline" | "hermes" | "prime-agent" | "gemini" | "aider" | "opencode" | "kilo">;

function oriTarget(harness: LaunchPlan["profile"]["harness"]): OriSupportedHarness {
  if (harness === "kilo") throw new Error("Ori does not launch Kilo; use the direct backend.");
  if (harness === "opencode") throw new Error("Ori does not launch legacy OpenCode; use the direct backend.");
  if (harness === "aider") throw new Error("Ori does not launch Aider; use the direct backend.");
  if (harness === "gemini") throw new Error("Ori does not launch Gemini CLI; use the direct backend.");
  if (harness === "prime-agent") throw new Error("Ori does not launch Prime Agent; use the direct backend.");
  if (harness === "omp") throw new Error("Ori does not support OMP; use the direct OMP adapter.");
  if (harness === "cline") throw new Error("Ori does not support Cline; use the direct Cline adapter.");
  if (harness === "hermes") throw new Error("Ori does not provide a Hermes adapter; use the direct Hermes backend.");
  return harness;
}

async function oriRequestForPlan(plan: LaunchPlan, options: OriPreparationOptions = {}) {
  validateHarnessProvider(plan.profile.harness, plan.provider);
  if (options.oriExecutable === "") throw new Error("--ori-executable requires a non-empty executable path.");
  const target = oriTarget(plan.profile.harness);
  if (plan.provider.authStyle !== "bearer") throw new Error("Ori requires the OpenRouter Bearer authentication contract; use the direct adapter for other auth styles.");
  assertOriLoginAllowed({...process.env, ...options.credentialEnv});
  const policyEnvironment = {...process.env, ...options.credentialEnv};
  if (plan.profile.harness === "grok" && !["", "0", "false", "no", "off"].includes((policyEnvironment.GROK_DISABLE_API_KEY_AUTH ?? "").trim().toLowerCase()))
    throw new Error("Grok API-key authentication is disabled by GROK_DISABLE_API_KEY_AUTH. This provider launch cannot proceed under that native authentication policy.");
  if (plan.profile.harness === "grok" && policyEnvironment.GROK_FORCE_LOGIN_TEAM_ID?.trim())
    throw new Error("Grok requires a native team login through GROK_FORCE_LOGIN_TEAM_ID. This provider launch cannot proceed under that native authentication policy.");
  const contract = await inspectOri({executable: options.oriExecutable, cwd: options.cwd ? resolve(options.cwd) : undefined});
  const native = requireOriHarness(contract, target);
  if (!native.path) throw new Error("Ori did not report the native harness executable path.");
  const detection = await detectHarness(target, native.path);
  if (!detection.available) throw new Error("The native harness reported by Ori could not report its version.");
  validateHarnessVersion(target, detection.version);
  const catalogPath = target === "codex" && options.stateDir ? await writeOriCodexCatalog(options.stateDir, plan.catalog.models) : undefined;
  const request = buildOriRequest(plan, target, catalogPath, options.args ?? []);
  validateOriLaunchRequest(request);
  return {contract, request};
}

export async function validateOriForPlan(plan: LaunchPlan, options: Pick<OriPreparationOptions, "oriExecutable" | "args" | "credentialEnv" | "cwd"> = {}): Promise<{contract: OriContract; request: ReturnType<typeof buildOriRequest>; warnings: string[]}> {
  const result = await oriRequestForPlan(plan, options);
  return {...result,warnings:oriLaunchWarnings(result.request.target)};
}

function buildOriRequest(plan: LaunchPlan, target: OriSupportedHarness, catalogPath: string | undefined, args: string[]) {
  return {
    target, provider: plan.provider.id, providerBaseUrl: plan.provider.baseUrl,
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
  const launchDeadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
  const profile = await client.getProfile(profileId);
  assertHarnessArguments(profile.harness,options.args ?? []);
  if (profile.harness === "gemini") validateHarnessProvider(profile.harness, await client.getProvider(profile.providerId));
  await validateHarnessConfiguration(profile.harness,resolve(options.cwd??process.cwd()),options.args);
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
  await validateHarnessConfiguration(plan.profile.harness,resolve(options.cwd??process.cwd()),options.args);
  const backend = options.backend ?? "direct";
  if (backend !== "direct" && backend !== "ori") throw new Error("Unknown launch backend; use direct or ori.");
  if (backend === "ori" && options.executable) throw new Error("--executable is ambiguous with --backend ori; use --ori-executable PATH.");
  if (backend === "direct" && options.oriExecutable) throw new Error("--ori-executable requires --backend ori.");
  const detection = backend === "direct" ? await detectHarness(plan.profile.harness, options.executable) : undefined;
  if (backend === "direct" && !detection?.available) throw new Error(harnessInstallationMessage(plan.profile.harness, detection?.executable ?? plan.profile.harness, Boolean(options.executable)));
  if (backend === "direct" && plan.profile.harness === "gemini") validateHarnessVersion("gemini", detection?.version);
  if(backend==="direct"&&plan.profile.harness==="aider")validateHarnessVersion(plan.profile.harness,detection?.version);
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
  let preparationSignal: CommandInterrupted | undefined;
  let preparationCleanup: Promise<void> | undefined;
  let preparationTimeout: ReturnType<typeof setTimeout> | undefined;
  let lateCreateRunFinalization: Promise<void> | undefined;
  let createRunCancelled = false;
  let runFinalized = false;
  const finishRunOnce = async (candidate: Awaited<ReturnType<SwitcherClient["createRun"]>>, body: {status: "interrupted" | "exited" | "failed"; exitCode: number}, message: string) => {
    if (runFinalized) return;
    runFinalized = true;
    await client.finishRun(candidate.id, candidate.version, body, crypto.randomUUID())
      .catch(() => console.error(message));
  };
  let cancelPreparation!: (error: CommandInterrupted) => void;
  const preparationCancellation = new Promise<never>((_, reject) => { cancelPreparation = reject; });
  // A deadline can expire before an adapter reaches its beforeLaunch race;
  // keep the cancellation promise handled in that synchronous path too.
  void preparationCancellation.catch(() => undefined);
  try {
    const prepared = ori?.prepared ? {...ori.prepared, configPaths: []} : await prepareHarnessLaunch({
      harness:plan.profile.harness, baseUrl:plan.provider.baseUrl, protocol:plan.provider.protocol,
      model:plan.profile.model, models:plan.catalog.models.filter(m=>harnessEligible(m,plan.profile.harness)),
      credential, authStyle:plan.provider.authStyle, executable:options.executable ?? detection?.executable, args:options.args ?? [], stateDir,
      cwd:resolve(options.cwd ?? process.cwd()), version:detection?.version,
      ...(["pi","omp","dsh","cline","hermes","prime-agent","gemini","aider","opencode","kilo"].includes(plan.profile.harness) ? {sessionDir:join(root,"sessions",plan.profile.harness,profileId)} : {}),
    });
    cleanup = prepared.cleanup;
    for (const warning of [...plan.warnings,...prepared.warnings]) console.error(`switcher: ${warning}`);
    // Some adapters must start an owned native supervisor before the normal
    // harness process can install its signal handlers. Keep this narrow
    // handler in the launcher, race cancellation through readiness and run
    // creation, and let the adapter's cleanup terminate only its own state.
    const interruptPreparation = (error: CommandInterrupted, cancel = true) => {
      if (preparationSignal) return;
      preparationSignal = error;
      // Set this before rejecting the cancellation promise. A createRun
      // promise can resolve in the same turn as cancellation, before the
      // Promise.race rejection continuation records that it lost.
      createRunCancelled = true;
      preparationCleanup ??= cleanup?.().catch(error => {
        console.error(`switcher: Could not clean up the interrupted launch: ${error instanceof Error ? error.message : "unknown cleanup failure"}.`);
      });
      if (cancel) cancelPreparation(preparationSignal);
    };
    const onPreparationSignal = (signal: NodeJS.Signals) => {
      if (preparationSignal) return;
      const exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129;
      interruptPreparation(new CommandInterrupted(exitCode, "Launch was interrupted before the native harness started."));
    };
    const onInt = () => onPreparationSignal("SIGINT");
    const onTerm = () => onPreparationSignal("SIGTERM");
    const onHangup = () => onPreparationSignal("SIGHUP");
    const hasPreparation = Boolean(prepared.beforeLaunch);
    const needsPreparationCancellation = hasPreparation || launchDeadline !== undefined;
    if (needsPreparationCancellation) {
      process.on("SIGINT", onInt); process.on("SIGTERM", onTerm); process.on("SIGHUP", onHangup);
      const remaining = launchDeadline === undefined ? undefined : launchDeadline - Date.now();
      if (remaining !== undefined) {
        if (remaining <= 0) interruptPreparation(new CommandInterrupted(143, "Launch timed out before the native harness started."));
        else preparationTimeout = setTimeout(() => interruptPreparation(new CommandInterrupted(143, "Launch timed out before the native harness started.")), remaining);
      }
    }
    try {
      if (preparationSignal) throw preparationSignal;
      if (prepared.beforeLaunch) await Promise.race([prepared.beforeLaunch(), preparationCancellation]);
      if (preparationSignal) throw preparationSignal;
      const createRunPromise = client.createRun({profileId,model:plan.profile.model,harness:plan.profile.harness,planToken:plan.planToken});
      lateCreateRunFinalization = createRunPromise.then(async lateRun => {
        if (!createRunCancelled) return;
        await finishRunOnce(lateRun,{status:"interrupted",exitCode:preparationSignal?.exitCode ?? 143},"switcher: A cancelled run could not be finalized; inspect the run through the API.");
      }).catch(error => {
        if (createRunCancelled) console.error(`switcher: A cancelled run could not be created: ${error instanceof Error ? error.message : "unknown error"}.`);
      });
      try { run = await Promise.race([createRunPromise, preparationCancellation]); }
      catch (error) { createRunCancelled = true; throw error; }
      if (preparationSignal) throw preparationSignal;
    } finally {
      if (preparationTimeout) clearTimeout(preparationTimeout);
      if (needsPreparationCancellation) {
        process.off("SIGINT", onInt); process.off("SIGTERM", onTerm); process.off("SIGHUP", onHangup);
      }
    }
    const remainingRuntime = launchDeadline === undefined ? undefined : launchDeadline - Date.now();
    if (remainingRuntime !== undefined && remainingRuntime <= 0) {
      interruptPreparation(new CommandInterrupted(143, "Launch timed out before the native harness started."), false);
      throw preparationSignal;
    }
    const {code,interrupted} = await runHarnessProcess({executable:prepared.executable,args:prepared.args,cwd:resolve(options.cwd ?? process.cwd()),env:{...childEnvironment(),...prepared.env},timeoutMs:remainingRuntime});
    await finishRunOnce(run,{status:interrupted?"interrupted":code===0?"exited":"failed",exitCode:code},`switcher: Harness exited ${code}; final metadata could not be saved for run ${run!.id}.`);
    return code;
  } catch (error) {
    if (run) await finishRunOnce(run,{status:preparationSignal ? "interrupted" : "failed",exitCode:preparationSignal?.exitCode ?? 1},"switcher: Could not persist final run status; inspect the run through the API.");
    throw error;
  } finally {
    if (lateCreateRunFinalization) {
      let finalizationTimer: ReturnType<typeof setTimeout> | undefined;
      const finalizationTimeout = new Promise<void>(resolve => { finalizationTimer = setTimeout(resolve,LATE_RUN_FINALIZATION_TIMEOUT_MS); });
      try { await Promise.race([lateCreateRunFinalization,finalizationTimeout]); }
      finally { if (finalizationTimer) clearTimeout(finalizationTimer); }
    }
    await preparationCleanup;
    try { await cleanup?.(); }
    finally { await rm(stateDir,{recursive:true,force:true}); }
  }
}
