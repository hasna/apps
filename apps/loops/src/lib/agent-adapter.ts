import { spawn } from "node:child_process";
import type { AgentProvider, AgentSandbox, AgentTarget } from "../types.js";
import { scrubSecrets } from "./redact.js";

export type ProviderPromptChannel = "stdin" | "argv";

export interface ProviderCapabilities {
  /** Sandbox values the provider CLI accepts; empty when sandboxing is unsupported. */
  sandbox: readonly AgentSandbox[];
  /** Whether the provider runs as a durable background agent instead of a one-shot process. */
  durable: boolean;
  /** Whether the provider can be dispatched to a remote machine transport. */
  remote: boolean;
  /** How the prompt reaches the provider process. */
  promptChannel: ProviderPromptChannel;
}

export interface AgentInvocation {
  command: string;
  args: string[];
  /** Prompt delivered on stdin; unset only for argv-channel providers. */
  stdin?: string;
  /** Executables of which at least one must exist besides the command itself. */
  preflightAnyOf?: string[];
}

export interface ProviderAdapter {
  provider: AgentProvider;
  capabilities: ProviderCapabilities;
  validate(target: AgentTarget, label?: string): void;
  buildInvocation(target: AgentTarget): AgentInvocation;
}

export const UNSAFE_CODEWITH_EXEC_EXTRA_ARGS = new Set([
  "e",
  "exec",
  "agent",
  "start",
  "--ephemeral",
  "--ignore-rules",
  "--skip-git-repo-check",
  "--json",
  "--output-last-message",
  "-o",
  "--output-schema",
  "--dangerously-bypass-approvals-and-sandbox",
]);

const CODEX_LIKE_SANDBOXES: readonly AgentSandbox[] = ["read-only", "workspace-write", "danger-full-access"];
const CURSOR_SANDBOXES: readonly AgentSandbox[] = ["enabled", "disabled"];
const PERMISSION_MODES = ["default", "plan", "auto", "bypass"];

function assertOptionalNonEmptyString(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
}

function validateAgentOptions(target: AgentTarget, label: string, capabilities: ProviderCapabilities): void {
  const provider = target.provider;
  if (typeof target.prompt !== "string" || target.prompt.trim() === "") {
    throw new Error(`${label}.prompt must be a non-empty string`);
  }
  assertOptionalNonEmptyString(target.model, `${label}.model`);
  assertOptionalNonEmptyString(target.variant, `${label}.variant`);
  assertOptionalNonEmptyString(target.agent, `${label}.agent`);
  assertOptionalNonEmptyString(target.authProfile, `${label}.authProfile`);
  assertOptionalNonEmptyString(target.configIsolation, `${label}.configIsolation`);
  if (target.configIsolation !== undefined && target.configIsolation !== "safe" && target.configIsolation !== "none") {
    throw new Error(`${label}.configIsolation must be safe or none`);
  }
  if (target.authProfile !== undefined && provider !== "codewith") {
    throw new Error(`${label}.authProfile is currently supported only for provider codewith`);
  }
  if (provider === "opencode" && (typeof target.model !== "string" || target.model.trim() === "")) {
    throw new Error(`${label}.model is required for provider opencode; pass a provider/model id such as openrouter/google/gemini-2.5-flash`);
  }
  if (provider === "cursor" && target.variant !== undefined) {
    throw new Error(`${label}.variant is not supported for provider cursor`);
  }
  if (provider === "codex" && target.agent !== undefined) {
    throw new Error(`${label}.agent is not supported for provider codex`);
  }
  if (provider === "codewith" && target.agent !== undefined) {
    throw new Error(`${label}.agent is not supported for provider codewith`);
  }
  if (provider === "codewith") {
    const unsafe = target.extraArgs?.find((arg) => UNSAFE_CODEWITH_EXEC_EXTRA_ARGS.has(arg));
    if (unsafe) {
      throw new Error(`${label}.extraArgs cannot include ${unsafe}; codewith exec launch flags are managed by the adapter`);
    }
  }
  if (target.addDirs?.length && !["codewith", "codex"].includes(provider)) {
    throw new Error(`${label}.addDirs is currently supported only for provider codewith or codex`);
  }
  if (target.permissionMode !== undefined) {
    if (!PERMISSION_MODES.includes(target.permissionMode)) {
      throw new Error(`${label}.permissionMode must be one of ${PERMISSION_MODES.join(", ")}`);
    }
    if (target.permissionMode === "plan" && !["claude", "cursor"].includes(provider)) {
      throw new Error(`${label}.permissionMode plan is currently supported only for provider claude or cursor`);
    }
    if (target.permissionMode === "auto" && provider !== "claude") {
      throw new Error(`${label}.permissionMode auto is currently supported only for provider claude`);
    }
  }
  if (target.sandbox !== undefined) {
    if (!capabilities.sandbox.length) {
      throw new Error(`${label}.sandbox is currently supported only for provider codewith, codex, or cursor`);
    }
    if (!capabilities.sandbox.includes(target.sandbox)) {
      throw new Error(`${label}.sandbox must be one of ${capabilities.sandbox.join(", ")}`);
    }
  }
}

function codewithLikeSandbox(target: AgentTarget): AgentSandbox {
  return target.sandbox ?? (target.permissionMode === "bypass" ? "danger-full-access" : "workspace-write");
}

function configStringValue(value: string): string {
  return JSON.stringify(value);
}

function buildAgentInvocation(target: AgentTarget): AgentInvocation {
  const isolation = target.configIsolation ?? "safe";
  const permissionMode = target.permissionMode ?? "default";
  const args: string[] = [];
  switch (target.provider) {
    case "claude": {
      if (isolation === "safe") args.push("--safe-mode", "--setting-sources", "local", "--no-session-persistence");
      if (permissionMode !== "default") {
        const mode = permissionMode === "bypass" ? "bypassPermissions" : permissionMode;
        args.push("--permission-mode", mode);
      }
      args.push("-p", "--output-format", "json");
      if (target.model) args.push("--model", target.model);
      if (target.variant) args.push("--effort", target.variant);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return { command: "claude", args, stdin: target.prompt };
    }
    case "cursor": {
      args.push(
        "-c",
        [
          "set -eu",
          "if command -v agent >/dev/null 2>&1; then",
          "  exec agent \"$@\"",
          "else",
          "  echo 'Executable not found in PATH: agent' >&2",
          "  exit 127",
          "fi",
        ].join("\n"),
        "openloops-cursor",
        "-p",
        "--trust",
      );
      if (permissionMode === "plan") args.push("--mode", "plan");
      if (permissionMode === "bypass") args.push("--force");
      const cursorSandbox = target.sandbox ?? (isolation === "safe" ? "enabled" : undefined);
      if (cursorSandbox) args.push("--sandbox", cursorSandbox);
      if (target.model) args.push("--model", target.model);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return { command: "sh", args, stdin: target.prompt, preflightAnyOf: ["agent"] };
    }
    case "codewith": {
      // Non-interactive `codewith exec` runs a fresh session per invocation, so it
      // avoids the ~1.9MB rollout history that `codewith agent start` reloaded on
      // every turn (which drove context_length_exceeded silent no-ops and stalled
      // the route/task-lifecycle worker launch). exec honors --auth-profile,
      // streams JSONL via --json, and keeps network egress for gh/git.
      args.push(...(target.authProfile ? ["--auth-profile", target.authProfile] : []));
      if (target.variant) args.push("-c", `model_reasoning_effort=${configStringValue(target.variant)}`);
      const sandbox = codewithLikeSandbox(target);
      // workspace-write sandboxes disable outbound network by default; route/PR
      // workers need gh/git egress, so opt the workspace sandbox back into it.
      if (sandbox === "workspace-write") args.push("-c", "sandbox_workspace_write.network_access=true");
      args.push("--ask-for-approval", "never", "exec", "--json", "--ephemeral", "--sandbox", sandbox, "--skip-git-repo-check");
      if (target.cwd) args.push("--cd", target.cwd);
      for (const dir of target.addDirs ?? []) args.push("--add-dir", dir);
      if (target.model) args.push("--model", target.model);
      args.push(...(target.extraArgs ?? []));
      // exec reads instructions from stdin when no positional prompt is given,
      // keeping the (possibly large) prompt off argv.
      return { command: "codewith", args, stdin: target.prompt };
    }
    case "codex": {
      if (target.variant) args.push("-c", `model_reasoning_effort=${configStringValue(target.variant)}`);
      args.push("--ask-for-approval", "never", "exec", "--json", "--ephemeral", "--sandbox", codewithLikeSandbox(target), "--skip-git-repo-check");
      if (isolation === "safe") args.push("--ignore-rules");
      if (target.cwd) args.push("--cd", target.cwd);
      for (const dir of target.addDirs ?? []) args.push("--add-dir", dir);
      if (target.model) args.push("--model", target.model);
      args.push(...(target.extraArgs ?? []));
      return { command: "codex", args, stdin: target.prompt };
    }
    case "aicopilot":
    case "opencode": {
      args.push("run", "--format", "json");
      if (isolation === "safe") args.push("--pure");
      if (permissionMode === "bypass") args.push("--dangerously-skip-permissions");
      if (target.cwd) args.push("--dir", target.cwd);
      if (target.model) args.push("--model", target.model);
      if (target.variant) args.push("--variant", target.variant);
      if (target.agent) args.push("--agent", target.agent);
      args.push(...(target.extraArgs ?? []));
      return { command: target.provider, args, stdin: target.prompt };
    }
  }
}

function adapterFor(provider: AgentProvider, capabilities: ProviderCapabilities): ProviderAdapter {
  return {
    provider,
    capabilities,
    validate(target: AgentTarget, label: string = provider): void {
      validateAgentOptions(target, label, capabilities);
    },
    buildInvocation(target: AgentTarget): AgentInvocation {
      validateAgentOptions(target, provider, capabilities);
      return buildAgentInvocation(target);
    },
  };
}

export const PROVIDER_ADAPTERS: Record<AgentProvider, ProviderAdapter> = {
  claude: adapterFor("claude", { sandbox: [], durable: false, remote: true, promptChannel: "stdin" }),
  cursor: adapterFor("cursor", { sandbox: CURSOR_SANDBOXES, durable: false, remote: true, promptChannel: "stdin" }),
  codewith: adapterFor("codewith", { sandbox: CODEX_LIKE_SANDBOXES, durable: false, remote: true, promptChannel: "stdin" }),
  codex: adapterFor("codex", { sandbox: CODEX_LIKE_SANDBOXES, durable: false, remote: true, promptChannel: "stdin" }),
  aicopilot: adapterFor("aicopilot", { sandbox: [], durable: false, remote: true, promptChannel: "stdin" }),
  opencode: adapterFor("opencode", { sandbox: [], durable: false, remote: true, promptChannel: "stdin" }),
};

export const AGENT_PROVIDERS = Object.keys(PROVIDER_ADAPTERS) as AgentProvider[];

export function providerAdapter(provider: AgentProvider): ProviderAdapter {
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) throw new Error(`unsupported agent provider: ${String(provider)}`);
  return adapter;
}

export interface SpawnCaptureOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface CapturedProcessResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

const DEFAULT_CAPTURE_MAX_OUTPUT_BYTES = 256 * 1024;

export function killProcessGroup(pgid: number): void {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    try {
      process.kill(pgid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      try {
        process.kill(pgid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 2_000).unref();
}

/**
 * Byte-bounded UTF-8 output accumulator shared by the capture paths
 * (spawnCapture here, executeTarget/executeRemoteSpec in executor.ts).
 *
 * - Callers feed decoded strings (`stream.setEncoding("utf8")` keeps
 *   multi-byte sequences split across pipe chunks intact); the buffer never
 *   decodes chunks itself.
 * - Truncation keeps at most `maxBytes` BYTES of tail, cutting at a UTF-8
 *   sequence boundary so the retained text never starts mid-character.
 * - The truncation marker reports the CUMULATIVE dropped byte count.
 * - The accumulated text is scrubbed BEFORE every cut: truncation can bisect
 *   a credential so the surviving fragment no longer matches any scrub
 *   pattern, while scrubbing first turns the intact token into [SCRUBBED]
 *   and the cut then slices through the marker harmlessly (scrubSecrets is
 *   idempotent, so store-time re-scrubbing stays safe).
 */
export class BoundedOutputBuffer {
  private text = "";
  private truncatedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: string): void {
    if (!chunk) return;
    this.text += chunk;
    if (Buffer.byteLength(this.text, "utf8") <= this.maxBytes) return;
    this.text = scrubSecrets(this.text);
    const encoded = Buffer.from(this.text, "utf8");
    if (encoded.length <= this.maxBytes) return;
    let start = encoded.length - this.maxBytes;
    // Advance past UTF-8 continuation bytes (0b10xxxxxx) to a sequence start.
    while (start < encoded.length && (encoded[start] & 0b1100_0000) === 0b1000_0000) start++;
    this.truncatedBytes += start;
    this.text = encoded.subarray(start).toString("utf8");
  }

  value(): string {
    if (this.truncatedBytes === 0) return this.text;
    return `[truncated ${this.truncatedBytes} bytes]\n${this.text}`;
  }
}

/**
 * Async replacement for short spawnSync calls: never blocks the event loop and
 * always enforces an explicit timeout that kills the child's process group.
 */
export async function spawnCapture(command: string, args: string[], opts: SpawnCaptureOptions): Promise<CapturedProcessResult> {
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_CAPTURE_MAX_OUTPUT_BYTES;
  const stdout = new BoundedOutputBuffer(maxOutputBytes);
  const stderr = new BoundedOutputBuffer(maxOutputBytes);
  let timedOut = false;
  let error: string | undefined;

  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) killProcessGroup(child.pid);
  }, opts.timeoutMs);
  timer.unref();

  // setEncoding decodes with a persistent StringDecoder, so multi-byte UTF-8
  // sequences split across pipe-chunk boundaries never become U+FFFD.
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => stdout.append(chunk));
  child.stderr?.on("data", (chunk: string) => stderr.append(chunk));

  const [status, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    child.once("error", (err) => {
      error = err.message;
      resolve([null, null]);
    });
    child.once("close", (code, sig) => resolve([code, sig]));
  });
  clearTimeout(timer);
  if (timedOut && !error) error = `timed out after ${opts.timeoutMs}ms`;
  return { status, signal, stdout: stdout.value(), stderr: stderr.value(), error, timedOut };
}
