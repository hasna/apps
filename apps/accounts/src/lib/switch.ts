import type { Profile, ToolDef } from "../types.js";
import { AccountsError } from "../types.js";
import { applyProfile } from "./apply.js";
import { prepareClaudeProfileKeychain } from "./claude-auth.js";
import {
  claudeApiAuthClearingEnv,
  formatEnvAssignments,
  formatExportLines,
  profileEnv,
  quotePosixShellWord,
} from "./env.js";
import { ensureSharedCapabilities } from "./shared-capabilities.js";
import { ensureSharedClaudeSessions } from "./claude-session-registry.js";
import { resolveStore, type AccountsStore } from "./store.js";
import { backendForProfile } from "./backend-routes.js";
import { launchArgv, planLaunch } from "./launch-plan.js";
import type { SwitchAccountResult } from "./switch-account.js";
import {
  BUILTIN_TOOLS,
  getTool,
  mergeToolArgs,
  normalizePermissionPreset,
} from "./tools.js";
import {
  isSensitiveCredentialKey,
  redactArgv,
  redactEnvironment,
  redactText,
} from "./redaction.js";

export type SwitchMode = "auto" | "apply" | "env" | "active";

export interface SwitchOptions {
  tool?: string;
  mode?: SwitchMode;
  resume?: boolean;
  args?: string[];
  permissions?: string;
}

export interface SwitchResult {
  profile: Profile;
  tool: ToolDef;
  applied: boolean;
  active: boolean;
  env: Record<string, string>;
  exports: string;
  command: string[];
  commandLine: string;
  /** Inherited-env names the launch plan owns and must remove before spawn. */
  unsetEnv?: string[];
  permissions?: string;
  restartRequired: boolean;
  message: string;
}

export interface PublicSwitchResult {
  schema: "hasna.accounts.switch-output/v1";
  profile: {
    name: string;
    tool: string;
  };
  tool: {
    id: string;
    label: string;
  };
  applied: boolean;
  active: boolean;
  command: string[];
  commandLine: string;
  permissions?: string;
  restartRequired: boolean;
  message: string;
}

function commandLine(
  env: Record<string, string>,
  command: string[],
  unsetEnvKeys: readonly string[] = [],
): string {
  const assignments = formatEnvAssignments(env, process.env, unsetEnvKeys);
  return `${assignments} ${command.map(quotePosixShellWord).join(" ")}`.trim();
}

function publicCommandLine(
  env: Record<string, string>,
  command: string[],
  additionalUnset: readonly string[] = [],
): string {
  const publicEnv = redactEnvironment(env);
  const unsetEnvKeys: string[] = [...additionalUnset];
  for (const [name, value] of Object.entries(env)) {
    if (value !== "" && isSensitiveCredentialKey(name)) {
      delete publicEnv[name];
      unsetEnvKeys.push(name);
    }
  }
  return commandLine(publicEnv, command, unsetEnvKeys);
}

/** Return a trusted display label without reflecting caller-controlled custom labels. */
export function publicToolLabel(toolId: string): string {
  return BUILTIN_TOOLS.find((tool) => tool.id === toolId)?.label ?? "Custom tool";
}

export function publicSwitchMessage(
  profileName: string,
  toolLabel: string,
  applied: boolean,
): string {
  return applied
    ? `${profileName} is now the live/default ${toolLabel} profile`
    : `${profileName} is now the active ${toolLabel} profile`;
}

/** Project an internal switch result to the only shape allowed on public output. */
export function publicSwitchResult(result: SwitchResult | SwitchAccountResult): PublicSwitchResult {
  const launchResult = "command" in result ? result : undefined;
  const command = redactArgv(launchResult?.command ?? []);
  const applied = "dirKind" in result ? result.dirKind === "live-default" : result.applied;
  const toolLabel = publicToolLabel(result.tool.id);
  return {
    schema: "hasna.accounts.switch-output/v1",
    profile: {
      name: result.profile.name,
      tool: result.profile.tool,
    },
    tool: {
      id: result.tool.id,
      label: toolLabel,
    },
    applied,
    active: launchResult?.active ?? true,
    command,
    commandLine: launchResult
      ? publicCommandLine(launchResult.env, command, launchResult.unsetEnv ?? [])
      : "",
    ...(launchResult?.permissions ? { permissions: redactText(launchResult.permissions) } : {}),
    restartRequired: result.restartRequired,
    message: publicSwitchMessage(result.profile.name, toolLabel, applied),
  };
}

function argsFor(profile: Profile, tool: ToolDef, opts: SwitchOptions): string[] {
  const args = [...(opts.resume ? (tool.resumeArgs ?? []) : []), ...(opts.args ?? [])];
  return mergeToolArgs(tool, args, { permissions: opts.permissions, profile });
}

function commandFor(profile: Profile, tool: ToolDef, opts: SwitchOptions): string[] {
  return [tool.bin, ...argsFor(profile, tool, opts)];
}

export async function switchProfile(
  name: string,
  opts: SwitchOptions = {},
  store: AccountsStore = resolveStore(),
): Promise<SwitchResult> {
  const profile = await store.getProfile(name, opts.tool);
  const tool = getTool(profile.tool);
  const mode = opts.mode ?? "auto";
  if (!["auto", "apply", "env", "active"].includes(mode)) {
    throw new AccountsError(`invalid switch mode "${mode}"`);
  }
  let applied = false;

  // A backend-bound profile authenticates through a vault secret injected by
  // `secrets exec`; its native OAuth/keychain machinery is NEVER consulted
  // (design 01a00e8a §42-44, §70). Apply restores native OAuth auth to the
  // live default paths, which a bound profile does not own — refuse loudly
  // (same shape as the supervisor's Phase 1 refusal) instead of touching the
  // keychain. Every other mode returns the launch-plan env and routes the
  // restart command through the plan's structural wrapper.
  const boundBackend = backendForProfile(profile);
  if (boundBackend) {
    if (mode === "apply") {
      throw new AccountsError(
        `profile "${profile.name}" is bound to backend "${boundBackend.id}"; \`accounts switch --mode apply\` restores native Claude OAuth auth, which a backend-bound profile does not use — launch it with \`accounts launch ${profile.name}\` instead (Phase 1: applying a bound profile is refused rather than touching the live keychain)`,
      );
    }
    await store.useProfile(profile.name, tool.id);
    // planLaunch treats its argv input as the args AFTER the tool bin (its
    // backend branch sets `command: tool.bin`), so pass the merged args
    // WITHOUT the bin — commandFor would duplicate it into `claude claude`.
    const boundPlan = await planLaunch(profile, tool, argsFor(profile, tool, opts), {
      backend: boundBackend,
    });
    const env = boundPlan.publicEnv;
    const command = launchArgv(boundPlan);
    return {
      profile: await store.getProfile(profile.name, tool.id),
      tool,
      applied: false,
      active: true,
      env,
      exports: formatExportLines(env),
      command,
      commandLine: commandLine(env, command, boundPlan.unsetEnv),
      unsetEnv: boundPlan.unsetEnv,
      ...(opts.permissions ? { permissions: normalizePermissionPreset(opts.permissions) } : {}),
      restartRequired: opts.resume === true || mode === "env",
      message: publicSwitchMessage(profile.name, publicToolLabel(tool.id), false),
    };
  }

  if (mode === "apply" || (mode === "auto" && tool.id === "claude")) {
    await applyProfile(profile.name, tool.id, store);
    applied = true;
  } else {
    await store.useProfile(profile.name, tool.id);
  }

  // In applied mode the session reads the live home rather than the profile
  // dir, so `profileEnv` is skipped — but the profile dir must still be
  // repaired, or `switch` (the headline way to change profiles) leaves it
  // broken for every later isolated launch.
  ensureSharedCapabilities(profile.dir, tool);
  if (tool.id === "claude") ensureSharedClaudeSessions(profile.dir);
  const env = applied && tool.id === "claude" ? claudeApiAuthClearingEnv() : await profileEnv(profile, tool);
  const command = commandFor(profile, tool, opts);
  prepareClaudeProfileKeychain(profile.dir, tool, profile.name);
  const restartRequired = opts.resume === true || applied || mode === "env";
  const message = publicSwitchMessage(
    profile.name,
    publicToolLabel(tool.id),
    applied,
  );

  return {
    profile: await store.getProfile(profile.name, tool.id),
    tool,
    applied,
    active: true,
    env,
    exports: formatExportLines(env),
    command,
    commandLine: commandLine(env, command),
    ...(opts.permissions ? { permissions: normalizePermissionPreset(opts.permissions) } : {}),
    restartRequired,
    message,
  };
}
