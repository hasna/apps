import { prepareOriModelPolicy } from "./ori-model-policy";
import type {PreparedLaunch} from "./harness-types";
import { assertHarnessArguments } from "./harness-arguments";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SwitcherClient } from "./sdk";
import { CommandInterrupted, Fault, codingEligible, harnessEligible, modelExpired, validateHarnessProvider, type LaunchPlan, type ProviderInput } from "./domain";
import { providerCredential } from "./presets";
import { providerCredentialFingerprint, providerCredentialSetupCommand } from "./provider-credential-onboarding";
import { privateDirectory, switcherHome } from "./runtime";
import { prepareHarnessLaunch, detectHarness, codexModel, validateHarnessVersion, validateHarnessConfiguration } from "./harnesses";
import { harnessInstallationMessage } from "./harness-installation";
import { runHarnessProcess, HarnessSettlementError } from "./harness-process";
import { inspectCodexNative, codexConfigGuard, codexDirectoryGuard } from "./codex-native";
import { oriLaunchWarnings, assertOriLoginAllowed, inspectOri, prepareOriLaunch, requireOriHarness, validateOriLaunchRequest, type OriContract, type OriLaunchPlan } from "./ori-backend";

import { prepareChatGPTLaunch, preflightChatGPTLaunch } from "./chatgpt-launch";
import { prepareClaudeDesktopLaunch } from "./claude-desktop-launch";
import type { ChatGPTInstallation, ClaudeDesktopInstallation } from "./desktop-apps";
import type { ReasoningEffort } from "./reasoning";
import { childEnvironment } from "./harness-environment";
import { assertCodexCanonicalLaunch, assertNativeInstructionOverlay, legacyNativeStateWarnings, nativeStateEnvironment, projectNativeState, resolveNativeState, validateNativeStateVersion, type NativeState } from "./native-state";
import { listCodexSessions, resolveCodexResumeArguments } from "./codex-session-discovery";
import type { RoutingEvent } from "./inference-gateway";
export { childEnvironment } from "./harness-environment";
export type LaunchBackend = "direct" | "ori";
export type LaunchOptions = {desktop?: ChatGPTInstallation; claudeDesktop?:ClaudeDesktopInstallation; shareNativeState?:boolean; reasoning?:ReasoningEffort; dangerouslyBypassApprovalsAndSandbox?:boolean; backend?: LaunchBackend; oriExecutable?: string; cwd?: string; executable?: string; stateDir?: string; args?: string[]; timeoutMs?: number; refresh?: boolean; credentialEnv?: NodeJS.ProcessEnv; credentialPreflight?:string; resolveCredential?: (provider: ProviderInput)=>Promise<string | undefined>};
const LATE_RUN_FINALIZATION_TIMEOUT_MS = 5_000;

async function writeOriCodexCatalog(stateDir: string, models: LaunchPlan["catalog"]["models"]): Promise<string> {
  const path = join(stateDir, "ori-codex-models.json");
  const nativeModels = models.filter(codingEligible).map((model,index)=>codexModel(model,index));
  await writeFile(path, JSON.stringify({models: nativeModels}, null, 2) + "\n", {mode: 0o600, flag: "wx"});
  return path;
}

type OriPreparationOptions = Pick<LaunchOptions, "oriExecutable" | "args" | "resolveCredential" | "credentialEnv"> & {stateDir?: string; cwd?: string; onRoutingEvent?:(event:RoutingEvent)=>void; sharedState?:NativeState};
type OriSupportedHarness = Exclude<LaunchPlan["profile"]["harness"], "omp" | "cline" | "hermes" | "prime-agent" | "gemini" | "aider" | "opencode" | "kilo" | "antigravity" | "junie">;

function oriTarget(harness: LaunchPlan["profile"]["harness"]): OriSupportedHarness {
  if (harness === "antigravity" || harness === "junie") throw new Error("This CLI is supported through the direct Switcher backend only.");
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
  return {contract, request, detection};
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

export async function prepareOriForPlan(plan: LaunchPlan, options: OriPreparationOptions & {stateDir:string}): Promise<{contract: OriContract; prepared: PreparedLaunch}> {
  const {contract, request,detection} = await oriRequestForPlan(plan, options);
  const credential = options.resolveCredential ? await options.resolveCredential(plan.provider) : providerCredential(plan.provider, options.credentialEnv);
  if (!credential) throw new Fault(400,"credential_setup_required",`OpenRouter credential setup is required. Run: ${providerCredentialSetupCommand(plan.provider)}.`);
  const ori = prepareOriLaunch({...request, executable: contract.executable, environment: {...process.env, ...options.credentialEnv, OPENROUTER_API_KEY: credential}});
  const native=await prepareHarnessLaunch({harness:plan.profile.harness,baseUrl:plan.provider.baseUrl,protocol:plan.provider.protocol,authStyle:plan.provider.authStyle,
    model:plan.profile.model,models:plan.catalog.models.filter(m=>modelExpired(m)||harnessEligible(m,plan.profile.harness)),modelPolicy:plan.profile.modelPolicy,
    providerId:plan.provider.id,onRoutingEvent:options.onRoutingEvent,credential,executable:detection.executable,version:detection.version,
    stateDir:options.stateDir,cwd:resolve(options.cwd??process.cwd()),args:options.args??[],sharedState:options.sharedState});
  try {
    const shim=prepareOriModelPolicy(request.target as "codex"|"grok",native);
    const dir=join(options.stateDir,"ori-bin"),path=join(dir,shim.name);
    await mkdir(dir,{mode:0o700}); await writeFile(path,shim.script,{mode:0o700,flag:"wx"});
    return {contract,prepared:{...ori,env:{...ori.env,...shim.env,PATH:`${dir}:${ori.env.PATH??process.env.PATH??""}`},configPaths:[...native.configPaths,path],
      beforeLaunch:native.beforeLaunch,closeTransport:native.closeTransport,cleanup:native.cleanup,warnings:[...native.warnings,"Ori performs its own OpenRouter catalog/auth checks; its native child uses Switcher's prepared model policy and gateway."]}};
  }catch(error){await native.cleanup?.();throw error;}
}

export async function launch(client: SwitcherClient, profileId: string, options: LaunchOptions = {}): Promise<number> {
  const launchDeadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
  const profile = await client.getProfile(profileId);
  if((options.reasoning||options.dangerouslyBypassApprovalsAndSandbox)&&(profile.harness!=="codex"||(options.backend??"direct")!=="direct"))throw new Error("Reasoning and full-access launch options require direct Codex or ChatGPT.");
  assertHarnessArguments(profile.harness,options.args ?? []);
  if (profile.harness === "gemini" || profile.harness === "antigravity") validateHarnessProvider(profile.harness, await client.getProvider(profile.providerId));
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
  if(options.credentialPreflight&&providerCredentialFingerprint(plan.provider)!==options.credentialPreflight)
    throw new Fault(409,"credential_preflight_changed","The provider authority or credential contract changed after authentication. Retry the launch; no credential was sent.");
  const backend = options.backend ?? "direct";
  if (backend !== "direct" && backend !== "ori") throw new Error("Unknown launch backend; use direct or ori.");
  if (backend === "ori" && options.executable) throw new Error("--executable is ambiguous with --backend ori; use --ori-executable PATH.");
  if (backend === "direct" && options.oriExecutable) throw new Error("--ori-executable requires --backend ori.");
  if (options.desktop && (plan.profile.harness !== "codex" || backend !== "direct")) throw new Error("ChatGPT requires the direct Codex provider adapter.");
  if (options.claudeDesktop && (options.desktop || plan.profile.harness !== "claude" || backend !== "direct" || options.executable || options.args?.length)) throw new Error("Claude desktop requires its direct Messages gateway adapter without native CLI overrides.");
  if (options.shareNativeState && !["codex", "claude"].includes(plan.profile.harness))
    throw new Fault(400, "native_state_harness", "--share-native-state is supported only for Codex, ChatGPT, Claude CLI and Claude desktop launches.");
  if (backend !== "direct" && ["codex", "claude"].includes(plan.profile.harness))
    throw new Fault(400, "native_state_backend", "Shared native state requires the direct native adapter; Ori state/resume integration is not yet accepted.");
  const managedCodex = plan.profile.harness === "codex" && backend === "direct";
  const directCodex = managedCodex && !options.desktop;
  // Read-only admission before credential resolution, private state creation or
  // any native version probe. Desktop helpers reuse the same accepted binding.
  const canonicalState = managedCodex ? await resolveNativeState("codex", process.env, { create: false }) : undefined;
  const previousCodexHome = canonicalState ? resolve(process.env.CODEX_HOME ?? canonicalState.home) : undefined;
  const codexChecks: Array<() => Promise<void>> = [];
  if (canonicalState) {
    codexChecks.push(await codexDirectoryGuard(canonicalState.home), await codexConfigGuard(canonicalState.home));
    if (canonicalState.sqliteHome && canonicalState.sqliteHome !== canonicalState.home) codexChecks.push(await codexDirectoryGuard(canonicalState.sqliteHome));
    await assertCodexCanonicalLaunch(canonicalState, previousCodexHome);
    if (previousCodexHome !== canonicalState.home) codexChecks.push(await codexDirectoryGuard(previousCodexHome!), await codexConfigGuard(previousCodexHome!));
  }
  const codex = managedCodex ? await inspectCodexNative(options.desktop ? undefined : options.executable) : undefined;
  if (codex) codexChecks.push(codex.guard);
  const nativeExecutable = options.desktop?.codexExecutable ?? options.executable;
  const detection = codex ? { available: true, executable: codex.executable, version: "0.154.0" }
    : backend === "direct" && !options.claudeDesktop ? await detectHarness(plan.profile.harness, nativeExecutable) : undefined;
  if (backend === "direct" && !options.claudeDesktop && !detection?.available) throw new Error(harnessInstallationMessage(plan.profile.harness, detection?.executable ?? plan.profile.harness, Boolean(options.executable)));
  if (backend === "direct" && plan.profile.harness === "gemini") validateHarnessVersion("gemini", detection?.version);
  if(backend==="direct"&&plan.profile.harness==="aider")validateHarnessVersion(plan.profile.harness,detection?.version);
  if (options.desktop) validateNativeStateVersion("codex", detection?.version);
  const root = resolve(options.stateDir ?? join(switcherHome(),"state"));
  const desktopAdmission = options.desktop && canonicalState && codex
    ? await preflightChatGPTLaunch(join(root,"desktop",profileId),canonicalState,codex) : undefined;
  await privateDirectory(root);
  const stateDir = await mkdtemp(join(root,"launch-"));
  let credential: string | undefined;
  if (backend === "direct") {
    try {
      credential = options.resolveCredential ? await options.resolveCredential(plan.provider) : providerCredential(plan.provider, options.credentialEnv);
      if (plan.provider.credentialEnv && !credential) throw new Fault(400,"credential_setup_required",`Provider credential setup is required. Run: ${providerCredentialSetupCommand(plan.provider)}. Or provide ${plan.provider.credentialEnv} in this launch process.`);
    } catch (error) { await rm(stateDir, {recursive: true, force: true}); throw error; }
  }
  let run: Awaited<ReturnType<SwitcherClient["createRun"]>> | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  let closeTransport: (() => Promise<void>) | undefined;
  let preparationSignal: CommandInterrupted | undefined;
  let preparationCleanup: Promise<void> | undefined;
  let preparationTimeout: ReturnType<typeof setTimeout> | undefined;
  let lateCreateRunFinalization: Promise<void> | undefined;
  let createRunCancelled = false;
  let runFinalized = false;
  let settlementUncertain = false;
  const cleanupPrepared = async () => {
    try { await cleanup?.(); cleanup = undefined; }
    catch (error) {
      // Cleanup may be the first observer of a detached desktop bridge whose
      // native child has not settled. Preserve this across cancellation paths.
      settlementUncertain ||= error instanceof HarnessSettlementError;
      throw error;
    }
  };
  const routingEvents:RoutingEvent[]=[];
  let routingEventsDropped=0,routingBytes=0;
  const onRoutingEvent=(event:RoutingEvent)=>{const bytes=Buffer.byteLength(JSON.stringify(event));if(routingEvents.length<1000&&routingBytes+bytes<=512*1024){routingEvents.push(event);routingBytes+=bytes;}else routingEventsDropped=Math.min(1000000,routingEventsDropped+1);};
  const finishRunOnce = async (candidate: Awaited<ReturnType<SwitcherClient["createRun"]>>, body: {status: "interrupted" | "exited" | "failed"; exitCode: number}, message: string) => {
    if (runFinalized) return;
    runFinalized = true;
    await client.finishRun(candidate.id, candidate.version, {...body,routingEvents,routingEventsDropped}, crypto.randomUUID())
      .catch(() => console.error(message));
  };
  let cancelPreparation!: (error: CommandInterrupted) => void;
  const preparationCancellation = new Promise<never>((_, reject) => { cancelPreparation = reject; });
  // A deadline can expire before an adapter reaches its beforeLaunch race;
  // keep the cancellation promise handled in that synchronous path too.
  void preparationCancellation.catch(() => undefined);
  try {
    const sharedState = canonicalState ?? (plan.profile.harness === "codex" || plan.profile.harness === "claude"
      ? await resolveNativeState(plan.profile.harness) : undefined);
    // Account credentials and Electron state stay private even when the corpus is shared.
    const desktopState = profileId;
    const stateWarnings = sharedState ? await legacyNativeStateWarnings(root, sharedState) : [];
    let nativeHome: string | undefined;
    if (canonicalState) nativeHome = canonicalState.home;
    else if (sharedState && !options.desktop && !options.claudeDesktop) {
      const variable = sharedState.tool === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
      const configured = process.env[variable] ? resolve(process.env[variable]!) : undefined;
      nativeHome = sharedState.tool === "claude" && (!configured || configured === sharedState.home)
        ? join(root, "native-claude", profileId) : configured ?? sharedState.home;
      await privateDirectory(nativeHome);
      await assertNativeInstructionOverlay(sharedState, nativeHome);
      await projectNativeState(sharedState, nativeHome);
    }
    const input = {
      harness:plan.profile.harness,baseUrl:plan.provider.baseUrl,protocol:plan.provider.protocol,authStyle:plan.provider.authStyle,model:plan.profile.model,models:plan.catalog.models.filter(m=>modelExpired(m)||harnessEligible(m,plan.profile.harness)),modelPolicy:plan.profile.modelPolicy,providerId:plan.provider.id,onRoutingEvent,credential,stateDir,cwd:resolve(options.cwd??process.cwd()),sharedState,
    };
    let prepared = options.claudeDesktop ? await prepareClaudeDesktopLaunch(input,options.claudeDesktop,join(root,"desktop-claude",desktopState)) : backend === "ori" ? (await prepareOriForPlan(plan,{...options,stateDir,onRoutingEvent,sharedState})).prepared : await prepareHarnessLaunch({
      harness:plan.profile.harness, baseUrl:plan.provider.baseUrl, protocol:plan.provider.protocol,
      model:plan.profile.model, models:plan.catalog.models.filter(m=>modelExpired(m)||harnessEligible(m,plan.profile.harness)),
      modelPolicy:plan.profile.modelPolicy,providerId:plan.provider.id,onRoutingEvent,
      reasoning:options.reasoning,dangerouslyBypassApprovalsAndSandbox:options.dangerouslyBypassApprovalsAndSandbox,
      credential, authStyle:plan.provider.authStyle, executable:codex?.executable ?? nativeExecutable ?? detection?.executable, args:options.args ?? [], stateDir,
      cwd:resolve(options.cwd ?? process.cwd()), version:detection?.version,sharedState,
      ...(["pi","omp","dsh","cline","hermes","prime-agent","gemini","aider","opencode","kilo","antigravity","junie"].includes(plan.profile.harness) ? {sessionDir:join(root,"sessions",plan.profile.harness,profileId)} : {}),
    });
    cleanup = prepared.cleanup;
    closeTransport = prepared.closeTransport;
    prepared = {...prepared,warnings:[...prepared.warnings,...stateWarnings]};
    if (sharedState) prepared = {...prepared,env:{...prepared.env,...nativeStateEnvironment(sharedState),
      ...(nativeHome ? {[sharedState.tool === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"]:nativeHome} : {})}};
    if (directCodex && codex && canonicalState) {
      const authHome = join(stateDir, "auth");
      await mkdir(authHome, { mode: 0o700 });
      codexChecks.push(await codexDirectoryGuard(authHome, true));
      codexChecks.push(async () => { if ((await readdir(authHome)).length) throw new Fault(409, "codex_auth_changed", "The new private Codex credential directory changed before launch."); });
      prepared = {...prepared, executable: codex.executable,
        args: ["--auth-home", authHome, "-c", 'cli_auth_credentials_store="file"', ...prepared.args]};
    }
    const checkCodex = async () => {
      for (const check of codexChecks) await check();
      if (canonicalState) await assertCodexCanonicalLaunch(canonicalState, previousCodexHome);
    };
    if (sharedState?.tool === "codex" && !options.desktop && backend === "direct" && options.args?.length) {
      const baseArgs = prepared.args.slice(0, prepared.args.length - options.args.length);
      await checkCodex();
      const resumedArgs = await resolveCodexResumeArguments({...prepared,args:baseArgs}, options.args, input.cwd,
        (pagePlan, cwd, query) => listCodexSessions(pagePlan, cwd, query, checkCodex));
      prepared = {...prepared,args:[...baseArgs,...resumedArgs]};
    }
    if (options.desktop) {
      prepared = await prepareChatGPTLaunch(prepared,options.desktop,stateDir,join(root,"desktop",desktopState),sharedState,desktopAdmission);
      cleanup = prepared.cleanup;
      closeTransport = prepared.closeTransport;
    }
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
      preparationCleanup ??= cleanupPrepared().catch(error => {
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
      await checkCodex();
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
    const {code,interrupted} = await runHarnessProcess({executable:prepared.executable,args:prepared.args,cwd:resolve(options.cwd ?? process.cwd()),env:{...childEnvironment(),...prepared.env},silent:Boolean(options.desktop||options.claudeDesktop),timeoutMs:remainingRuntime,
      ...(codex ? { beforeSpawn: checkCodex } : {})});
    // Close native background traffic before persisting the final routing log.
    await cleanupPrepared();
    await finishRunOnce(run,{status:interrupted?"interrupted":code===0?"exited":"failed",exitCode:code},`switcher: Harness exited ${code}; final metadata could not be saved for run ${run!.id}.`);
    return code;
  } catch (error) {
    settlementUncertain ||= error instanceof HarnessSettlementError;
    // Flush gateway observations before recording failures, including cancelled
    // native background requests. Cleanup errors must not hide the launch error.
    if (settlementUncertain) {
      // A live child may still need its files, but its owned network service
      // must stop before failure metadata is persisted.
      try { await closeTransport?.(); closeTransport=undefined; } catch { /* retried in finally */ }
    } else {
      await preparationCleanup;
      try { await cleanupPrepared(); } catch { /* retried in finally or retained on uncertainty */ }
    }
    if (run) await finishRunOnce(run,{status:preparationSignal ? "interrupted" : "failed",exitCode:preparationSignal?.exitCode ?? 1},"switcher: Could not persist final run status; inspect the run through the API.");
    throw error;
  } finally {
    if (lateCreateRunFinalization) {
      let finalizationTimer: ReturnType<typeof setTimeout> | undefined;
      const finalizationTimeout = new Promise<void>(resolve => { finalizationTimer = setTimeout(resolve,LATE_RUN_FINALIZATION_TIMEOUT_MS); });
      try { await Promise.race([lateCreateRunFinalization,finalizationTimeout]); }
      finally { if (finalizationTimer) clearTimeout(finalizationTimer); }
    }
    if (settlementUncertain) {
      try { await closeTransport?.(); }
      catch { console.error("switcher: Owned transport shutdown failed; launch files remain retained."); }
    } else {
      await preparationCleanup;
      try { await cleanupPrepared(); }
      catch (error) {
        if (settlementUncertain) {
          try { await closeTransport?.(); }
          catch { console.error("switcher: Owned transport shutdown failed; launch files remain retained."); }
        }
        throw error;
      }
      await rm(stateDir,{recursive:true,force:true});
    }
  }
}
