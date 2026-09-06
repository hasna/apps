/**
 * @hasna/hooks - Open source Claude Code hooks library
 *
 * Install hooks with a single command:
 *   npx @hasna/hooks install gitguard branchprotect
 *
 * Or use the interactive CLI:
 *   npx @hasna/hooks
 */

export {
  HOOKS,
  HOOK_EVENTS,
  CATEGORIES,
  getHook,
  getHookEvents,
  getHooksByCategory,
  searchHooks,
  type HookMeta,
  type HookEvent,
  type Category,
} from "./lib/registry.js";
import type { HookEvent as HookEventType } from "./lib/registry.js";

export {
  installHook,
  installHooks,
  getInstalledHooks,
  getRegisteredHooks,
  getRegisteredHooksForTarget,
  removeHook,
  uninstallHook,
  hookExists,
  buildCodewithTomlFragment,
  getHookPath,
  getSettingsPath,
  isEventSupported,
  type InstallResult,
  type InstallOptions,
  type Scope,
  type ConcreteTarget,
  type Target,
  type CodewithInstallMode,
  type UninstallResult,
} from "./lib/installer.js";

// ── Hook runtime types ────────────────────────────────────────────────────────

export interface HookAgentInfo {
  agent_id: string;
  agent_type: "claude" | "gemini" | "codewith" | "custom";
  name?: string;
  preferences?: Record<string, unknown>;
}

/** The JSON object passed to a hook via stdin */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: HookEventType | string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent?: HookAgentInfo;
  [key: string]: unknown;
}

/** The JSON object a PreToolUse hook returns via stdout */
export interface HookOutput {
  decision?: "approve" | "block";
  reason?: string;
  continue?: boolean;
  hookSpecificOutput?: {
    hookEventName: "SessionStart" | "UserPromptSubmit" | "SubagentStart" | "PreToolUse" | "PostToolUse" | "Stop" | "Notification" | "SessionEnd";
    additionalContext?: string;
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    updatedInput?: unknown;
  };
  [key: string]: unknown;
}

// ── Project-scoped SDK helpers ────────────────────────────────────────────────

import { installHook as _installHook, installHooks as _installHooks, removeHook as _removeHook, getRegisteredHooks as _getRegisteredHooks } from "./lib/installer.js";
import type { InstallOptions, InstallResult } from "./lib/installer.js";

/** Install a hook scoped to the current project (.claude/settings.json) */
export function installHookForProject(name: string, options: Omit<InstallOptions, "scope"> = {}): InstallResult {
  return _installHook(name, { ...options, scope: "project" });
}

/** Install multiple hooks scoped to the current project */
export function installHooksForProject(names: string[], options: Omit<InstallOptions, "scope"> = {}): InstallResult[] {
  return _installHooks(names, { ...options, scope: "project" });
}

/** List all hooks registered for the current project */
export function listProjectHooks(): string[] {
  return _getRegisteredHooks("project");
}

/** Remove a hook from the current project */
export function removeProjectHook(name: string): boolean {
  return _removeHook(name, "project");
}

// ── runHook — programmatic hook execution ─────────────────────────────────────

import { getHook as _getHook } from "./lib/registry.js";
import { getHookPath as _getHookPath, hookExists as _hookExists } from "./lib/installer.js";
import { existsSync, readFileSync } from "fs";

export interface RunHookOptions {
  /** Agent profile ID to inject into hook input */
  profile?: string;
  /**
   * Timeout in milliseconds. Wins over the hook manifest's timeout_ms when
   * set to a positive value; a non-positive value is ignored (the manifest
   * timeout or no timeout applies).
   */
  timeout?: number;
}

export interface RunHookResult {
  output: HookOutput;
  stderr: string;
  exitCode: number;
}

/**
 * Programmatically execute a hook with the given input.
 * Spawns the hook's src/hook.ts via bun, passes input as stdin JSON,
 * and returns the parsed stdout JSON.
 */
export async function runHook(name: string, input: HookInput, options: RunHookOptions = {}): Promise<RunHookResult> {
  const { readCustomManifest } = await import("./lib/manifest.js");
  const custom = readCustomManifest(name);
  const resolvedMeta = custom ? undefined : _getHook(name);
  if (!custom && !resolvedMeta) throw new Error(`Hook '${name}' not found`);

  const hookScript = _getHookPath(name) + "/src/hook.ts";
  const resolvedScript = custom?.scriptPath;
  const script = resolvedScript ?? (existsSync(hookScript) ? hookScript : undefined);
  if (!script) throw new Error(`Hook script not found: ${name}`);

  // Read the bytes ONCE. The verified bytes are the executed bytes: the path
  // is never re-opened for execution after the trust check (TOCTOU).
  const { sha256Of, checkScriptHash } = await import("./lib/store.js");
  const content = readFileSync(script);
  const check = checkScriptHash(name, sha256Of(content));
  if (!check.ok) {
    throw new Error(
      `Hook '${name}' script changed since it was trusted (sha256 ${check.expected} != ${check.actual}). Run 'hooks trust ${name}' to trust the new content.`,
    );
  }

  let hookInput = { ...input };
  if (options.profile) {
    const { getProfile } = await import("./lib/profiles.js");
    const profile = getProfile(options.profile);
    if (profile) {
      hookInput.agent = {
        agent_id: profile.agent_id,
        agent_type: profile.agent_type,
        name: profile.name,
        preferences: profile.preferences,
      };
    }
  }

  const { executeVerifiedScript, HookTimeoutError } = await import("./lib/run.js");
  // Caller-provided timeout wins over the manifest value; a non-positive
  // explicit value is treated as "not provided" (never as "no timeout").
  const manifestTimeout = custom?.manifest.timeout_ms ?? null;
  const effectiveTimeout =
    options.timeout !== undefined && options.timeout > 0
      ? options.timeout
      : manifestTimeout ?? null;
  const started = Date.now();
  let stdoutText = "";
  let stderrText = "";
  let exitCode = 0;
  try {
    ({ stdout: stdoutText, stderr: stderrText, exitCode } = await executeVerifiedScript({
      name,
      scriptPath: script,
      content,
      args: custom?.manifest.args ?? [],
      env: custom?.manifest.env,
      stdin: JSON.stringify(hookInput),
      timeout: effectiveTimeout ?? undefined,
    }));
  } catch (err) {
    if (err instanceof HookTimeoutError) {
      try {
        const { recordHookRun, resolveEventType } = await import("./lib/db-writer.js");
        recordHookRun({
          hookName: name,
          eventType: resolveEventType(input.hook_event_name, custom?.manifest.events[0] ?? "PostToolUse"),
          version: custom?.manifest.version,
          sha256: sha256Of(content),
          sessionId: typeof input.session_id === "string" ? input.session_id : null,
          toolName: typeof input.tool_name === "string" ? input.tool_name : null,
          toolInput: input.tool_input,
          error: err.message.slice(0, 500),
          exitCode: -1,
          durationMs: Date.now() - started,
          projectDir: process.cwd(),
        });
      } catch {
        // Observability must never mask the timeout.
      }
      throw err;
    }
    throw err;
  }
  const durationMs = Date.now() - started;

  // Every SDK run lands in hook_events so `hooks log` is never empty after a
  // real fire (bug ef58dcb7).
  try {
    const { recordHookRun, resolveEventType } = await import("./lib/db-writer.js");
    let outputJson: HookOutput = {};
    try { outputJson = JSON.parse(stdoutText); } catch {}
    const blocked = outputJson.decision === "block" || outputJson.continue === false;
    recordHookRun({
      hookName: name,
      eventType: resolveEventType(input.hook_event_name, custom?.manifest.events[0] ?? "PostToolUse"),
      version: custom?.manifest.version,
      sha256: sha256Of(content),
      sessionId: typeof input.session_id === "string" ? input.session_id : null,
      toolName: typeof input.tool_name === "string" ? input.tool_name : null,
      toolInput: input.tool_input,
      result: blocked ? "block" : "continue",
      error: exitCode !== 0 ? (stderrText || `hook exited with code ${exitCode}`).slice(0, 500) : null,
      exitCode,
      durationMs,
      projectDir: process.cwd(),
    });
  } catch {
    // Observability must never break execution.
  }

  let output: HookOutput = {};
  try {
    output = JSON.parse(stdoutText);
  } catch {
    output = { raw: stdoutText } as HookOutput;
  }

  return { output, stderr: stderrText, exitCode };
}

export {
  createProfile,
  getProfile,
  listProfiles,
  updateProfile,
  deleteProfile,
  touchProfile,
  getProfilesDir,
  exportProfiles,
  importProfiles,
  type AgentProfile,
  type CreateProfileInput,
} from "./lib/profiles.js";

export {
  HOOKS_STORAGE_ENV,
  HOOKS_STORAGE_FALLBACK_ENV,
  HOOKS_STORAGE_BACKEND_ENV,
  HOOKS_STORAGE_BACKEND_FALLBACK_ENV,
  HOOKS_STORAGE_TABLES,
  RETIRED_STORAGE_MODE_ENV,
  STORAGE_BACKENDS,
  STORAGE_BACKEND_ENV,
  STORAGE_DATABASE_ENV,
  STORAGE_TABLES,
  getStorageBackend,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStoragePg,
  getStorageStatus,
  getSyncMetaAll,
  parseStorageTables,
  resolveTables,
  runStorageMigrations,
  storagePull,
  storagePush,
  storageSync,
} from "./storage.js";
export type { StorageBackend, StorageEnv, StorageStatus, SyncMeta, SyncResult } from "./storage.js";

export {
  getHooksDataDir,
  getCustomHooksDir,
  getLockPath,
} from "./config.js";

export {
  resolveHooksTransport,
  resolveHooksServePublishKey,
  hooksRegistryOrigin,
  type HooksRemoteAuthority,
  type HooksCredentialOptions,
  type HooksTransportMode,
  type HooksTransportNotice,
  type HooksTransportOptions,
  type HooksTransportResolution,
} from "./lib/transport.js";
export type { HooksLocalOptInEnv } from "./lib/resolver-types.js";

export {
  getHookRecord,
  listHookRecords,
  upsertHookRecord,
  removeHookRecord,
  readLock,
  writeLock,
  setPinnedHook,
  getPinnedHook,
  removePinnedHook,
  pinInstalledHook,
  removeHookFromStore,
  verifyScriptHash,
  checkScriptHash,
  retrustHook,
  sha256Of,
  sha256File,
} from "./lib/store.js";
export type { HookRecord, LockEntry, LockFile, TrustCheck } from "./lib/store.js";

export {
  parseManifest,
  readCustomManifest,
  listCustomHooks,
  writeCustomHook,
  resolveScript,
} from "./lib/manifest.js";
export type { HookManifest, ParsedManifest } from "./lib/manifest.js";

export {
  resolveHook,
  resolveHookDir,
  resolveHookMeta,
  resolveScriptPath,
} from "./lib/resolve.js";
export type { ResolvedHook, HookSource } from "./lib/resolve.js";

export {
  installCustomSource,
  isCustomSource,
} from "./lib/custom-install.js";
export type { CustomInstallResult, CustomSourceKind } from "./lib/custom-install.js";

export {
  planSync,
  syncHooks,
  fetchPinnedHook,
} from "./lib/sync.js";
export type { SyncDiff, SyncPlan, ArtifactResponse, PinnedHookInstall } from "./lib/sync.js";

export {
  handleServeRequest,
  startServeServer,
  DEFAULT_SERVE_PORT,
} from "./serve.js";
export type { CatalogEntry, ArtifactPayload } from "./serve.js";

export {
  provisionCloudflareResources,
} from "./cf/provision.js";
export type { ProvisionOptions, ProvisionResult } from "./cf/provision.js";
