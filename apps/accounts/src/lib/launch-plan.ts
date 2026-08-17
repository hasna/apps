// One structural process plan for every spawn surface, and the executor that
// runs it.
//
// A LaunchPlan is a complete, redactable description of how to start a harness
// binary: the binary, its args, the NON-SECRET environment it receives, the
// inherited-env conflicts the adapter owns, and the vault bindings that must
// wrap the process. The wrapper is always structural:
//
//   secrets exec <vaultKey> --as <adapter-auth-var> -- <binary> [args...]
//
// Accounts never reads, captures, or prints the secret value; `secrets exec`
// injects it into the child's environment at spawn time. `launchArgv` is the
// SINGLE place the wrapper is constructed, so the display path and the spawn
// path cannot drift apart.
//
// Auth modes:
//   - "native-profile": the profile's own OAuth/credential machinery applies
//     (existing behavior; `profileEnv` heals and the launch leases the
//     keychain as needed).
//   - "backend-api": the harness authenticates to a backend route via a vault
//     key. OAuth recovery/healing, keychain lease, and settings sanitization
//     are SKIPPED (design 01a00e8a §42-44, §70) — the profile dir is still
//     isolated, but its native auth is not consulted.

import { spawn } from "node:child_process";
import type { BackendRoute, Profile, ToolDef } from "../types.js";
import { AccountsError } from "../types.js";
import { formatEnvAssignments, profileEnv, providerLaunchEnv } from "./env.js";
import { claudeBackendAdapter } from "./backend-adapters/claude.js";
import { preparePortableCommand } from "./portable-command.js";
import { redactArgv, redactText } from "./redaction.js";
import { loadStore } from "../storage.js";

export type AuthMode = "native-profile" | "backend-api";

/** One vault locator -> harness env-var binding. NEVER a credential value. */
export interface SecretBinding {
  vaultKey: string;
  envVar: string;
}

export interface LaunchPlan {
  /** The harness binary (e.g. `claude`); the wrapper is derived, never stored. */
  command: string;
  args: string[];
  /** Non-secret env for the child. Never contains a credential value. */
  publicEnv: Record<string, string>;
  /** Inherited-env names the adapter owns and must remove before spawn. */
  unsetEnv: string[];
  /** Vault bindings wrapped around the spawn via `secrets exec`. */
  secretBindings: SecretBinding[];
  authMode: AuthMode;
}

export interface PlanLaunchOptions {
  backend?: BackendRoute;
  model?: string;
}

/**
 * Build the structural launch plan for one profile/tool/args combination.
 *
 * Without a backend the plan is the existing native path (the caller keeps
 * its current env/keychain handling); with a backend it becomes a
 * backend-api plan whose execution is `secrets exec <vaultKey> --as
 * <adapter-auth-var> -- <command> [args...]`.
 */
export async function planLaunch(
  profile: Profile,
  tool: ToolDef,
  args: string[],
  options: PlanLaunchOptions = {},
): Promise<LaunchPlan> {
  const backend = options.backend;
  if (!backend) {
    return {
      command: tool.bin,
      args,
      publicEnv: await profileEnv(profile, tool),
      unsetEnv: [],
      secretBindings: [],
      authMode: "native-profile",
    };
  }
  // The route must live in the machine-local registry: the plan's secret
  // binding is only meaningful against a route the operator registered (and
  // that passed semantic validation at add time). A caller-supplied object is
  // re-validated here so an unknown id fails at plan time, not in the child.
  const registered = loadStore().backends.find((candidate) => candidate.id === backend.id);
  if (!registered) {
    throw new AccountsError(
      `no backend route named "${backend.id}" — add it with \`accounts backend add\` (try \`accounts backend add --example deepseek\`)`,
    );
  }
  const adapter = claudeBackendAdapter(registered, options.model);
  return {
    command: tool.bin,
    args,
    publicEnv: await profileEnv(profile, tool, { backendRoute: registered, adapterEnv: adapter }),
    unsetEnv: adapter.unsetEnv,
    secretBindings: [{ vaultKey: registered.vaultKey, envVar: adapter.authEnvVar }],
    authMode: "backend-api",
  };
}

/**
 * The full argv Accounts spawns: the `secrets exec` wrapper when the plan
 * carries vault bindings, the bare harness otherwise. The ONE construction
 * site for the wrapper.
 */
export function launchArgv(plan: LaunchPlan): string[] {
  if (plan.secretBindings.length === 0) return [plan.command, ...plan.args];
  const bindings = plan.secretBindings;
  const argv: string[] = ["secrets", "exec"];
  for (const binding of bindings) {
    argv.push(binding.vaultKey, "--as", binding.envVar);
  }
  argv.push("--", plan.command, ...plan.args);
  return argv;
}

/**
 * The final environment: inherited env sanitized by `providerLaunchEnv`
 * (registry authority + request-debug denial — this MUST stay the final
 * sanitizer), overlayed with the plan's public env, then adapter-owned
 * conflicts removed.
 */
export function launchPlanEnv(
  plan: LaunchPlan,
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = providerLaunchEnv(parentEnv, plan.publicEnv);
  for (const name of plan.unsetEnv) delete env[name];
  return env;
}

/**
 * Redacted one-line render for the operator. The `secrets exec` wrapper is
 * rendered STRUCTURALLY from the validated vault locator and the adapter's
 * fixed env-var name (neither is a credential value), and only the harness
 * argv passes through `redactArgv` — running the wrapper itself through the
 * heuristics over-redacts to `[REDACTED]` for no safety gain.
 */
export function renderLaunchPlanCommand(
  plan: LaunchPlan,
  parentEnv: NodeJS.ProcessEnv = process.env,
): string {
  const envLine = formatEnvAssignments(plan.publicEnv, parentEnv, plan.unsetEnv);
  const harnessLine = redactArgv([plan.command, ...plan.args]).join(" ");
  const wrapperLine =
    plan.secretBindings.length === 0
      ? harnessLine
      : plan.secretBindings
          .map((binding) => `secrets exec ${binding.vaultKey} --as ${binding.envVar} -- ${harnessLine}`)
          .join(" && ");
  return `${envLine} ${wrapperLine}`;
}

/** Forward signals and relay the child's exit code back to the caller. */
export async function relayProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const prepared = preparePortableCommand(command, args, env);
    const child = spawn(prepared.command, prepared.args, {
      cwd,
      env,
      stdio: "inherit",
      windowsVerbatimArguments: prepared.windowsVerbatimArguments,
    });
    let forwardedSignal: NodeJS.Signals | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const forward = (signal: NodeJS.Signals) => {
      if (forwardedSignal) return;
      forwardedSignal = signal;
      child.kill(signal);
      killTimer = setTimeout(
        () => child.kill("SIGKILL"),
        numericTestSetting("ACCOUNTS_TEST_CHILD_KILL_TIMEOUT_MS", 2_500),
      );
      killTimer.unref();
    };
    const onSigint = () => forward("SIGINT");
    const onSigterm = () => forward("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const cleanup = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      if (killTimer) clearTimeout(killTimer);
    };
    child.once("error", (error) => {
      cleanup();
      reject(
        new AccountsError(
          `failed to launch ${redactText(command)}: ${redactText(error.message)}`,
        ),
      );
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolve(forwardedSignal ? signalExitCode(forwardedSignal) : (code ?? signalExitCode(signal)));
    });
  });
}

/** Execute a plan: final env, wrapper argv, relay. */
export async function runLaunchPlan(
  plan: LaunchPlan,
  parentEnv: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const env = launchPlanEnv(plan, parentEnv);
  const argv = launchArgv(plan);
  return relayProcess(argv[0]!, argv.slice(1), env, cwd);
}

function numericTestSetting(name: string, fallback: number): number {
  if (process.env.NODE_ENV !== "test") return fallback;
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return signal ? 1 : 0;
}
