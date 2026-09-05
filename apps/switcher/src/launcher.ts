import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { SwitcherClient } from "./sdk";
import { codingEligible } from "./domain";
import { prepareHarnessLaunch, detectHarness } from "./harnesses";

export function childEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TEMP|TMP|TERM|COLORTERM|LANG|LC_[A-Z_]+|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME|XDG_CACHE_HOME|SSH_AUTH_SOCK|GIT_SSH_COMMAND|EDITOR|VISUAL|NO_COLOR|FORCE_COLOR|CODEX_HOME|GROK_HOME|GROK_SANDBOX|GROK_DISABLE_API_KEY_AUTH|CLAUDE_CONFIG_DIR)$/;
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string,string] => allowed.test(entry[0]) && entry[1] !== undefined));
}
export async function launch(client: SwitcherClient, profileId: string, options: {cwd?: string; executable?: string; stateDir?: string; args?: string[]; timeoutMs?: number} = {}): Promise<number> {
  const profile = await client.getProfile(profileId);
  // A fresh snapshot is required for each launch. Errors remain visible.
  await client.refreshModels(profile.providerId);
  const plan = await client.launchPlan(profileId);
  const detection = await detectHarness(plan.profile.harness, options.executable);
  if (!detection.available) throw new Error(`Harness ${plan.profile.harness} is not installed; use --executable PATH after installing it.`);
  const credential = plan.provider.credentialEnv ? process.env[plan.provider.credentialEnv] : undefined;
  if (plan.provider.credentialEnv && !credential) throw new Error("Provider credential environment reference is not available in this local launcher process.");
  const root = resolve(options.stateDir ?? join(process.env.HASNA_SWITCHER_HOME ?? join(homedir(), ".hasna", "switcher"),"state"));
  await mkdir(root, {recursive:true,mode:0o700});
  const stateDir = await mkdtemp(join(root,"launch-"));
  let run: Awaited<ReturnType<SwitcherClient["createRun"]>> | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const prepared = await prepareHarnessLaunch({
      harness:plan.profile.harness, baseUrl:plan.provider.baseUrl, protocol:plan.provider.protocol,
      model:plan.profile.model, models:plan.catalog.models.filter(codingEligible),
      credential, authStyle:plan.provider.authStyle, executable:options.executable, args:options.args ?? [], stateDir,
      cwd:resolve(options.cwd ?? process.cwd()), version:detection.version,
    });
    cleanup = prepared.cleanup;
    for (const warning of [...plan.warnings,...prepared.warnings]) console.error(`switcher: ${warning}`);
    run = await client.createRun({profileId,model:plan.profile.model,harness:plan.profile.harness,planToken:plan.planToken});
    let interrupted = false;
    const code = await new Promise<number>((resolveCode,reject) => {
      const child = spawn(prepared.executable,prepared.args,{cwd:resolve(options.cwd ?? process.cwd()),env:{...childEnvironment(),...prepared.env},stdio:"inherit",shell:false});
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const forward = (signal: NodeJS.Signals) => { interrupted = true; child.kill(signal); killTimer ??= setTimeout(() => child.kill("SIGKILL"),5000).unref(); };
      const onInt = () => forward("SIGINT"); const onTerm = () => forward("SIGTERM");
      process.on("SIGINT",onInt); process.on("SIGTERM",onTerm);
      const timeout = options.timeoutMs ? setTimeout(() => forward("SIGTERM"),options.timeoutMs) : undefined;
      const cleanup = () => { process.off("SIGINT",onInt); process.off("SIGTERM",onTerm); if(timeout) clearTimeout(timeout); if(killTimer) clearTimeout(killTimer); };
      child.once("error",() => { cleanup(); reject(new Error("Harness process could not start; check executable and permissions.")); });
      child.once("exit",(code,signal) => { cleanup(); resolveCode(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 137)); });
    });
    await client.finishRun(run.id,run.version,{status:interrupted?"interrupted":code===0?"exited":"failed",exitCode:code},crypto.randomUUID())
      .catch(() => console.error(`switcher: Harness exited ${code}; final metadata could not be saved for run ${run!.id}.`));
    return code;
  } catch (error) {
    if (run) await client.finishRun(run.id,run.version,{status:"failed",exitCode:1}).catch(() => console.error("switcher: Could not persist final run status; inspect the run through the API."));
    throw error;
  } finally { await cleanup?.(); await rm(stateDir,{recursive:true,force:true}); }
}
