import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** The Ori 0.12.1 command name for a Switcher harness. */
export type OriTarget = "claude" | "codex" | "grok" | "opencode2";
export type OriProtocol = "anthropic-messages" | "openai-responses" | "openai-chat";
export type OriReasoningEffort = "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

export type OriProviderCatalogEntry = {
  id: "openrouter";
  displayName: "OpenRouter";
  credentialEnv: "OPENROUTER_API_KEY";
  publicModelsUrl: "https://openrouter.ai/api/v1/models";
  entitledModelsUrl: "https://openrouter.ai/api/v1/models/user";
  protocols: readonly OriProtocol[];
};

/**
 * Ori is an OpenRouter launcher, rather than a general provider adapter.
 * Keep this list immutable so callers cannot accidentally broaden the boundary.
 */
export const oriProviderCatalog: readonly OriProviderCatalogEntry[] = Object.freeze([{
  id: "openrouter",
  displayName: "OpenRouter",
  credentialEnv: "OPENROUTER_API_KEY",
  publicModelsUrl: "https://openrouter.ai/api/v1/models",
  entitledModelsUrl: "https://openrouter.ai/api/v1/models/user",
  protocols: ["anthropic-messages", "openai-responses", "openai-chat"],
}]);

/** Native Ori flags verified from `ori <target> --help` for 0.12.1. */
export const oriNativeFlags: Readonly<Record<"claude" | "codex" | "grok", readonly string[]>> = Object.freeze({
  claude: ["--model", "--reasoning-effort"],
  codex: ["--model", "--reasoning-effort"],
  grok: ["--model", "--reasoning-effort"],
});

export type OriCatalogInput = {
  /** IDs from Switcher's OpenRouter catalog; Ori does not own discovery. */
  modelIds: readonly string[];
  source: "switcher-openrouter";
};

export type OriHarnessAvailability = {
  kind: string;
  displayName?: string;
  installed: boolean;
  path?: string;
};

export type OriContract = {
  executable: string;
  version: string;
  harnesses: OriHarnessAvailability[];
};

export type OriEnvironment = NodeJS.ProcessEnv & {
  OPENROUTER_API_KEY?: string;
  ORI_FORCE_OPENROUTER_API_KEY?: string;
  ORI_REQUIRE_LOGIN?: string;
};

export type OriLaunchRequest = {
  target: OriTarget;
  provider: string;
  providerBaseUrl?: string;
  protocol?: OriProtocol;
  catalog?: OriCatalogInput;
  model: string;
  args?: string[];
  reasoningEffort?: OriReasoningEffort;
};

export type OriLaunchPlan = {
  executable: string;
  args: string[];
  env: Record<string, string>;
  target: OriTarget;
  provider: "openrouter";
  model: string;
  warnings: string[];
};

export class OriBackendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OriBackendError";
  }
}

const safeEnvironmentNames = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "TERM", "COLORTERM",
  "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
  "XDG_CACHE_HOME", "SSH_AUTH_SOCK", "GIT_SSH_COMMAND", "EDITOR", "VISUAL", "NO_COLOR", "FORCE_COLOR",
  "CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENROUTER_API_KEY",
]);

function safeEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (safeEnvironmentNames.has(name) && value !== undefined) result[name] = value;
  }
  // This is the documented noninteractive way to force Ori to consume only
  // the process-scoped OpenRouter key. It never places the key in argv.
  result.ORI_FORCE_OPENROUTER_API_KEY = "1";
  return result;
}

function parseVersion(stdout: string): string | undefined {
  try {
    const value = JSON.parse(stdout) as { data?: { version?: unknown } };
    if (typeof value.data?.version === "string") return value.data.version;
  } catch {
    // `--version` is human-readable when an explicit TTY mode is selected.
  }
  const match = stdout.match(/(?:@ori-runtime\/cli\s+|ori\s+v?)(\d+\.\d+\.\d+(?:[+.-][A-Za-z0-9.-]+)?)/i);
  return match?.[1];
}

function parseHarnesses(stdout: string): OriHarnessAvailability[] {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { throw new OriBackendError("invalid_contract", "Ori harness list was not valid JSON."); }
  const rows = (value as { data?: { launchable?: unknown } })?.data?.launchable;
  if (!Array.isArray(rows)) throw new OriBackendError("invalid_contract", "Ori harness list did not contain a launchable array.");
  return rows.flatMap((row): OriHarnessAvailability[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.kind !== "string" || typeof item.installed !== "boolean") return [];
    return [{kind: item.kind, displayName: typeof item.displayName === "string" ? item.displayName : undefined,
      installed: item.installed, path: typeof item.path === "string" ? item.path : undefined}];
  });
}

async function readOnly(executable: string, args: string[], environment: NodeJS.ProcessEnv, cwd?: string) {
  try {
    const result = await exec(executable, args, {cwd, env: safeEnvironment(environment), timeout: 10_000, maxBuffer: 256 * 1024}) as {stdout?: unknown; stderr?: unknown};
    return {code: 0, stdout: typeof result.stdout === "string" ? result.stdout : "", stderr: typeof result.stderr === "string" ? result.stderr : ""};
  } catch (error) {
    const failure = error as {code?: number | string; stdout?: string; stderr?: string; message?: string};
    return {code: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message ?? ""};
  }
}

/** Read Ori version and launchable harness inventory without auth or mutation. */
export async function inspectOri(options: {executable?: string; environment?: NodeJS.ProcessEnv; cwd?: string} = {}): Promise<OriContract> {
  const executable = options.executable ?? "ori";
  const environment = options.environment ?? process.env;
  const versionResult = await readOnly(executable, ["--version"], environment, options.cwd);
  if (versionResult.code !== 0) throw new OriBackendError("ori_unavailable", "Ori could not report its version; install it or pass an explicit executable.");
  const version = parseVersion(versionResult.stdout);
  if (!version) throw new OriBackendError("invalid_contract", "Ori --version did not report a version.");
  const inventoryResult = await readOnly(executable, ["harness", "list", "--json"], environment, options.cwd);
  if (inventoryResult.code !== 0) throw new OriBackendError("ori_unavailable", "Ori could not report its harness inventory.");
  return {executable, version, harnesses: parseHarnesses(inventoryResult.stdout)};
}

/** Keep the installed 0.12.x contract explicit; newer Ori builds need review. */
export function assertSupportedOriVersion(contract: OriContract): void {
  if (!/^0\.12\./.test(contract.version))
    throw new OriBackendError("ori_version_unsupported", `Ori ${contract.version} is outside the verified 0.12.x adapter contract.`);
}

/** Fail before Ori's interactive installer offer when the native binary is absent. */
export function requireOriHarness(contract: OriContract, target: OriTarget): OriHarnessAvailability {
  assertSupportedOriVersion(contract);
  if (target === "opencode2")
    throw new OriBackendError("unsupported_harness", "Ori 0.12.1 targets legacy `opencode`; it cannot launch OpenCode 2 (`opencode2`).");
  const row = contract.harnesses.find(harness => harness.kind === target);
  if (!row?.installed) throw new OriBackendError("harness_unavailable", `Ori cannot launch ${target} because its native harness is not installed; no installer was started.`);
  return row;
}

/** Assert the exact OpenRouter provider boundary before constructing argv. */
export function oriProvider(id: string): OriProviderCatalogEntry {
  const provider = oriProviderCatalog.find(entry => entry.id === id);
  if (!provider) throw new OriBackendError("provider_unsupported", "Ori supports OpenRouter only; use a direct Switcher adapter for this provider.");
  return provider;
}

function assertProviderAuthority(target: OriTarget, provider: string, providerBaseUrl: string | undefined, protocol: OriProtocol | undefined): void {
  const catalog = oriProvider(provider);
  const compatible = target === "codex" ? protocol === "openai-responses" : target === "claude" ? protocol === "anthropic-messages" : catalog.protocols.includes(protocol as OriProtocol);
  if (!providerBaseUrl || !protocol || !compatible)
    throw new OriBackendError("provider_authority", "Ori requires an explicit OpenRouter provider URL and a protocol supported by the selected Ori target.");
  let url: URL;
  try { url = new URL(providerBaseUrl); } catch { throw new OriBackendError("provider_authority", "Ori requires the OpenRouter HTTPS provider URL."); }
  const path = url.pathname.replace(/\/+$/, "");
  if (url.protocol !== "https:" || url.origin !== "https://openrouter.ai" || path !== "/api/v1" || url.username || url.password || url.search || url.hash)
    throw new OriBackendError("provider_authority", "Ori provider credentials may only be sent to https://openrouter.ai/api/v1.");
}

function configOverride(value: string): boolean {
  const compact = value.toLowerCase().replace(/[\s"']/g, "");
  return compact.includes("model_provider") || compact.includes("base_url") || compact.includes("wire_api") ||
    compact.includes("model_catalog_json") || compact.includes("auth_command") || compact.includes("env_http_headers");
}

function assertPassthrough(target: OriTarget, args: readonly string[]): void {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--model" || arg.startsWith("--model=") || arg === "-m" || (arg.startsWith("-m") && !arg.startsWith("--")) ||
      arg === "--reasoning-effort" || arg.startsWith("--reasoning-effort="))
    throw new OriBackendError("reserved_argument", "Ori model and reasoning options are reserved by the launch profile.");
    if (/^--(?:provider|model-provider|model_provider)(?:=|$)/.test(arg))
      throw new OriBackendError("reserved_argument", "Provider selection is reserved by the Ori launch profile.");
    if (target !== "codex") continue;
    if (arg === "--profile" || arg === "-p" || arg === "--config" || arg === "-c" || arg.startsWith("--profile=") || arg.startsWith("--config="))
      throw new OriBackendError("reserved_argument", "Codex profile and provider configuration are reserved by the Ori launch profile.");
    if (arg.startsWith("-c") && arg.length > 2 && configOverride(arg.slice(2)))
      throw new OriBackendError("reserved_argument", "Codex provider configuration is reserved by the Ori launch profile.");
    if ((arg === "--config" || arg === "-c") && configOverride(args[index + 1] ?? ""))
      throw new OriBackendError("reserved_argument", "Codex provider configuration is reserved by the Ori launch profile.");
  }
}

/**
 * Construct an argv-only Ori launch. This function does no process start and
 * does not read credentials; callers hand it the already-authorized environment.
 */
export function prepareOriLaunch(request: OriLaunchRequest & {executable?: string; environment?: NodeJS.ProcessEnv}): OriLaunchPlan {
  assertProviderAuthority(request.target, request.provider, request.providerBaseUrl, request.protocol);
  if (!request.model.trim()) throw new OriBackendError("model_required", "An OpenRouter model ID is required for an Ori launch.");
  const args = request.args ?? [];
  assertPassthrough(request.target, args);
  if (request.target === "opencode2")
    throw new OriBackendError("unsupported_harness", "Ori 0.12.1 targets legacy `opencode`; it cannot launch OpenCode 2 (`opencode2`).");
  if (request.target === "claude") throw new OriBackendError("global_config_mutation", "Ori Claude launches may update ~/.claude.json; the preservation subset supports Codex and Grok only.");
  const catalog = request.catalog;
  if (!catalog || catalog.source !== "switcher-openrouter" || !catalog.modelIds.includes(request.model))
    throw new OriBackendError("catalog_required", "The selected model must come from Switcher's OpenRouter catalog before an Ori launch.");
  const environment = request.environment ?? process.env;
  const loginPolicy = environment.ORI_REQUIRE_LOGIN?.trim().toLowerCase();
  if (loginPolicy && !["0", "false", "no", "off"].includes(loginPolicy))
    throw new OriBackendError("ori_login_required", "ORI_REQUIRE_LOGIN is enabled; this adapter cannot bypass native Ori login policy with an environment key.");
  const credential = environment.OPENROUTER_API_KEY?.trim();
  if (!credential) throw new OriBackendError("openrouter_key_missing", "An OpenRouter API key must be supplied in the launch environment before starting Ori.");
  if (/[\r\n]/.test(credential)) throw new OriBackendError("openrouter_key_invalid", "The OpenRouter API key contains invalid characters.");
  const oriArgs = [request.target, "--model", request.model];
  if (request.reasoningEffort) oriArgs.push("--reasoning-effort", request.reasoningEffort);
  oriArgs.push(...args);
  return {executable: request.executable ?? "ori", args: oriArgs, env: safeEnvironment(environment),
    target: request.target, provider: "openrouter", model: request.model, warnings: []};
}
