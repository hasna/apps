import { validateKiloArgs } from "./kilo";
import { dshArguments } from "./dsh-args";
import type { HarnessId } from "./harness-types";
import { aiderArguments } from "./aider-args";

const reserved: Record<HarnessId, readonly string[]> = {
  antigravity: ["--model", "--agent", "--remote-control", "--project", "--new-project"],
  junie: ["--model","--provider","--auth","-a","--openai-api-key","--anthropic-api-key","--grok-api-key","--openrouter-api-key","--google-api-key","--litellm-api-key","--litellm-url","--config-location","--config-default-locations","--model-location","--model-default-locations","--cache-dir","-c","--project","-p","--acp","--gateway","--gateway-stop","--gateway-status"],
  gemini: ["--model", "--no-model", "--no-m", "-m", "--settings", "--acp", "--experimental-acp", "--experimentalAcp"],
  "prime-agent": ["--model", "--provider", "--api-key", "--models", "--session-dir", "--daemon-socket"],
  hermes: ["--model", "-m", "--provider", "--config", "--profile", "-p", "--api-key", "--base-url", "--ignore-user-config", "--safe-mode", "--worktree", "-w"],
  cline: ["--provider", "-P", "--model", "-m", "--data-dir", "--config", "--cwd", "-c", "--auto-approve", "--autoapprove", "-y", "--yolo", "-z", "--zen", "--key", "-k", "--id", "--system", "-s", "--plan", "-p", "--json", "--retries", "--timeout", "-t", "--hooks-dir", "--worktree", "-i", "--tui"],
  kilo: [],
  aider: [],
  claude: ["--model", "--fallback-model", "--settings", "--setting-sources"],
  codex: ["--model", "-m", "--profile", "-p", "--oss", "--local-provider", "--remote", "--remote-auth-token-env", "--auth-home", "--daemon"],
  grok: ["--model", "-m", "--oauth", "--leader", "--leader-socket"],
  opencode: ["--model", "-m", "--attach", "--password", "-p", "--username", "-u", "--dir", "--port", "--hostname", "--mdns", "--mdns-domain", "--cors", "--auto"],
  opencode2: ["--model", "-m", "--server"],
  pi: ["--model", "--provider", "--api-key", "--models"],
  dsh: ["--patch", "--dump-config", "--dump-default-config"],
  // OMP's profile owns provider/model/config/session state and permission
  // policy. These native options can bypass that authority, load external
  // code/session state, or mutate global shell configuration.
  omp: ["--model", "--provider", "--api-key", "--profile", "--cwd", "--config", "--session-dir", "--models", "--no-rules", "--smol", "--slow", "--plan", "--prewalk", "--prewalk-into", "--plan-yolo-into", "--plan-yolo", "--auto-approve", "--yolo", "--approval-mode", "--alias", "--plugin-dir", "--hook", "--extension", "-e", "--trusted-extension", "--from-claude", "--from-codex"],
};
// Only option tokens are inspected: a required value or text following -- is
// not another flag. These are the supported native launch option contracts.
const values: Record<HarnessId, readonly string[]> = {
  antigravity: ["--add-dir","--conversation","--effort","-i","--prompt-interactive","--input-format","--json-schema","--log-file","--mode","--output-format","-p","--print","--prompt","--print-timeout"],
  junie: ["--task","--prompt","--session-id","--share-anonymous-statistics","--input-format","--output-format","--json-output-file","--agent-mode","--guidelines-filename","--ide-guidelines","--effort","--mcp-default-locations","--mcp-location","--extensions-default-location","--skill-default-locations","--skill-location","--command-default-location","--command-location","--agent-default-location","--agent-location"],
  gemini: ["--prompt", "-p", "--prompt-interactive", "--promptInteractive", "-i", "--approval-mode", "--approvalMode", "--policy", "--admin-policy", "--adminPolicy", "--allowed-mcp-server-names", "--allowedMcpServerNames", "--extensions", "-e", "--session-file", "--sessionFile", "--session-id", "--sessionId", "--include-directories", "--includeDirectories", "--output-format", "--outputFormat", "-o", "--allowed-tools", "--allowedTools", "--delete-session", "--deleteSession"],
  "prime-agent": ["--mode", "--system-prompt", "--append-system-prompt", "--name", "--session", "--session-id", "--fork", "--tools", "--exclude-tools", "--thinking", "--export", "--extension", "--skill", "--prompt-template", "--theme", "--use-theme", "--tui-mode", "--prompt", "--output-format"],
  hermes: ["--model", "--provider", "--reasoning", "--toolsets", "--skills", "--resume", "--usage-file", "--in", "--oneshot", "--query", "--query-file", "--image", "--max-turns", "--run-budget", "--source"],
  cline: ["--provider", "--model", "--data-dir", "--config", "--cwd", "--key", "--id", "--system", "--plan", "--json", "--retries", "--timeout", "--hooks-dir", "--worktree"],
  dsh: ["--profile"],
  kilo: [],
  aider: [],
  claude: ["--system-prompt", "--append-system-prompt", "--agent", "--agents", "--tools", "--allowedTools", "--disallowedTools", "--permission-mode", "--permission-prompts", "--output-format", "--input-format", "--json-schema", "--max-turns", "--max-budget-usd", "--mcp-config", "--session-id", "--plugin-dir"],
  codex: ["--config", "--image", "--sandbox", "--cd", "--add-dir", "--ask-for-approval", "--output-last-message", "--output-schema", "--color", "--enable", "--disable", "--thread-source", "--auth-home"],
  grok: ["--single", "--print", "--prompt-file", "--prompt-json", "--load", "--cwd", "--agent", "--agents", "--allow", "--allowedTools", "--deny", "--disallowedTools", "--debug-file", "--json-schema", "--max-turns", "--output-format", "--permission-mode", "--reasoning-effort", "--effort", "--rules", "--append-system-prompt", "--system-prompt", "--system-prompt-override", "--session-id", "--sandbox", "--tools", "--disallowed-tools", "--worktree-ref", "--ref"],
  // Native 1.18.29 uses yargs strings/arrays without nargs. A following option
  // stays an option; only an attached value or a non-option token is consumed.
  opencode: ["--session", "--prompt", "--agent", "--format", "--file", "--title", "--command", "--variant", "--log-level", "--replay-limit"],
  opencode2: ["--session", "--prompt", "--agent", "--format", "--file", "--title", "--log-level", "--completions"],
  pi: ["--mode", "--system-prompt", "--append-system-prompt", "--name", "--session", "--session-id", "--fork", "--session-dir", "--tools", "--exclude-tools", "--thinking", "--export", "--extension", "--skill", "--prompt-template", "--theme", "--use-theme", "--tui-mode", "-n", "-t", "-xt", "-e"],
  // Derived from OMP 18.1.11's `src/cli/flag-tables.ts` and `--help`:
  // values must be skipped even when they look like flags, while `--` ends
  // option parsing and leaves the remaining prompt literal.
  omp: ["--model", "--smol", "--slow", "--plan", "--prewalk-into", "--plan-yolo-into", "--provider", "--api-key", "--system-prompt", "--append-system-prompt", "--profile", "--cwd", "--mode", "--config", "--add-dir", "--session-dir", "--models", "--tools", "--thinking", "--service-tier", "--hook", "--extension", "-e", "--trusted-extension", "--plugin-dir", "--skills", "--export", "--max-time", "--approval-mode", "--fork", "--provider-session-id", "--prompt-cache-key"],
};
const optionalValues: Partial<Record<HarnessId, readonly string[]>> = {
  gemini: ["--resume", "--worktree"],
  "prime-agent": ["--resume", "--continue"],
  hermes: ["--continue"],
  claude: ["--resume", "--continue"], grok: ["--resume", "--worktree", "--local-workspace"], pi: ["--list-models"], omp: ["--resume", "-r", "--session"],
};
// clap and Effect support short clusters. Stop at a value-taking option, so
// -pTEXT in Grok or -oFILE in Codex cannot turn text into model flags. Pi's
// multi-letter options use its own exact-token parser and are not clusters.
const short: Partial<Record<HarnessId, { required: string; optional: string; boolean: string }>> = {
  junie: { required: "apc", optional: "", boolean: "hv" },
  hermes: { required: "zmtsrqp", optional: "c", boolean: "VhvQw" },
  cline: { required: "Pmksct", optional: "", boolean: "yz" },
  codex: { required: "cimpsCao", optional: "", boolean: "hV" },
  grok: { required: "psm", optional: "rw", boolean: "chv" },
  opencode: { required: "mspuf", optional: "", boolean: "chvi" },
  opencode2: { required: "smf", optional: "", boolean: "chv" },
  "prime-agent": { required: "p", optional: "", boolean: "hv" },
  gemini: { required: "mpieo", optional: "rw", boolean: "shvydl" },
};
const providerKeys = new Set(["model", "model_provider", "provider", "model_providers", "model_catalog_json", "review_model", "agents", "memories", "sqlite_home", "auth_home", "cli_auth_credentials_store", "profile", "profiles", "include"]);
export function codexOptionTakesValue(option: string): boolean {
  return values.codex.includes(option) || option.length===2 && option[0]==="-" && short.codex!.required.includes(option[1]);
}
export function codexOptionRequestsHelp(option: string): boolean {
  if (["--help","--version","-h","-V"].includes(option)) return true;
  if (!/^-[^-]/.test(option)) return false;
  for (let index=1;index<option.length;index++) {
    const name=option[index];if(name==="h"||name==="V")return true;
    if(short.codex!.required.includes(name))return false;
  }
  return false;
}
export function codexConfigPath(key: string): string[] {
  if(key.length>4096||/[\r\n\0]/.test(key))throw new Error("Invalid Codex configuration key.");
  let value:unknown=Bun.TOML.parse(`${key} = 0`);const path:string[]=[];
  while(value!==0){if(value===null||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid Codex configuration key.");const entries=Object.entries(value);if(entries.length!==1)throw new Error("Ambiguous Codex configuration key.");path.push(entries[0][0]);value=entries[0][1];}
  if(!path.length)throw new Error("Invalid Codex configuration key.");return path;
}
export function codexConfigRoots(key: string): string[] { return [codexConfigPath(key)[0]]; }
/** Locate a native subcommand without confusing option values or a literal
 * prompt after -- with that command. Reuse the validated Codex option grammar. */
export function codexCommandIndex(args: readonly string[]): number {
  for(let i=0;i<args.length;i++) {
    const arg=args[i];if(arg==="--")return -1;
    if(!arg.startsWith("-"))return i;
    if(arg.startsWith("--")) { if(!arg.includes("=")&&values.codex.includes(arg))i++;continue; }
    for(let j=1;j<arg.length;j++)if(short.codex!.required.includes(arg[j])) { if(j===arg.length-1)i++;break; }
  }
  return -1;
}
export function geminiPolicyArguments(input: readonly string[], originalHome: string): string[] {
  const args = [...input], expand = (value: string) => value.split(",").map(part => {const path = part.trim(); return path === "~" || path.startsWith("~/") ? originalHome + path.slice(1) : part;}).join(",");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]; if (arg === "--") break;
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("="), flag = equals < 0 ? arg : arg.slice(0, equals);
      if (["--policy", "--admin-policy", "--adminPolicy"].includes(flag)) {
        if (equals >= 0) args[i] = flag + "=" + expand(arg.slice(equals + 1));
        else if (args[i + 1] !== undefined) args[++i] = expand(args[i]);
      } else if (equals < 0 && (values.gemini.includes(flag) || optionalValues.gemini?.includes(flag) && args[i + 1] !== undefined && !args[i + 1].startsWith("-"))) i++;
    } else if (arg.startsWith("-")) {
      for (let j = 1; j < arg.length; j++) if ((short.gemini!.required + short.gemini!.optional).includes(arg[j])) {
        if (j === arg.length - 1 && (short.gemini!.required.includes(arg[j]) || args[i + 1] !== undefined && !args[i + 1].startsWith("-"))) i++;
        break;
      }
    }
  }
  return args;
}
function codexProviderOverride(value: string): boolean {
  const key = value.slice(0, value.indexOf("=") < 0 ? value.length : value.indexOf("=")).trim();
  // Match the TOML key syntax, including quoted roots, rather than looking for
  // provider words in unrelated option values such as a custom system prompt.
  try { return codexConfigRoots(key).some(root => providerKeys.has(root)); }
  catch { return /^(model|model_provider|provider|model_providers|model_catalog_json|review_model|agents|memories|sqlite_home|auth_home|cli_auth_credentials_store|profile|profiles|include)(?:\s*\.|\s*$)/.test(key); }
}

export function assertHarnessArguments(harness: HarnessId, args: readonly string[], options: { additionalReserved?: readonly string[]; reserveCodexConfig?: boolean; reservedCodexRoots?: readonly string[] } = {}): void {
  if(harness==="kilo"){validateKiloArgs([...args]);return;}
  if(harness==="aider"){aiderArguments(args);return;}
  const blocked = new Set([...reserved[harness], ...options.additionalReserved ?? []]);
  if(harness==="antigravity"&&args[0]&&!args[0].startsWith("-"))throw new Error("Antigravity subcommands are outside the managed inference launch; pass prompts with -p.");
  const reject = (): never => { throw new Error("Provider/model configuration arguments are reserved by the launch profile; update the profile instead."); };
  if (harness === "codex") {
    const command = codexCommandIndex(args);
    // These modes forward to a separate process/server whose provider binding
    // is outside this direct CLI launch. Literal prompts remain untouched.
    if (command >= 0 && ["app", "cloud", "exec-server", "agents"].includes(args[command])) reject();
    if (command >= 0 && args[command] === "app-server") {
      const nested = codexCommandIndex(args.slice(command + 1));
      if (nested >= 0 && ["daemon", "proxy"].includes(args[command + 1 + nested])) reject();
    }
  }
  if (harness === "hermes") {
    // Hermes 0.21.0 scans profile selectors BEFORE argparse with the top-level
    // value grammar, even after `chat`. Mirror that pass: --query does not
    // shield a following --profile from this native pre-parser.
    const rootValues = new Set(["-z", "--oneshot", "-m", "--model", "--provider", "--reasoning", "-t", "--toolsets", "-r", "--resume", "-s", "--skills", "--usage-file", "--in"]);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--") break;
      if (arg === "--profile" || arg === "-p" || arg.startsWith("--profile=")) reject();
      if (rootValues.has(arg) || ["--continue", "-c"].includes(arg) && args[i + 1] !== undefined && !args[i + 1].startsWith("-")) i++;
    }
  }
  const config = (value: string) => {
    if(harness!=="codex")return;
    const key=value.slice(0,value.indexOf("=")<0?value.length:value.indexOf("=")).trim();
    let reserved=false;try{reserved=codexConfigRoots(key).some(root=>options.reservedCodexRoots?.includes(root));}catch{reserved=Boolean(options.reservedCodexRoots?.some(root=>new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:\\s*\\.|\\s*$)`).test(key)));}
    if(options.reserveCodexConfig||codexProviderOverride(value)||reserved)reject();
  };
  let hermesChat = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;
    if (!arg.startsWith("-") || arg === "-") { if (harness === "hermes" && arg === "chat") hermesChat = true; continue; }
    const equals = arg.indexOf("=");
    let flag = equals < 0 ? arg : arg.slice(0, equals);
    // Antigravity uses Go-style flags: one or two leading dashes are equivalent.
    if (harness === "antigravity" && /^-[^-].+/.test(flag)) flag = "-" + flag;
    if (harness === "hermes" && flag.startsWith("--")) {
      // Python argparse accepts unique long-option prefixes. Ambiguous
      // prefixes cannot launch; reserving any profile prefix also keeps a
      // top-level option from becoming an override before the chat parser.
      if ([...blocked].some(option => option.startsWith(flag))) reject();
      const matches = values.hermes.concat(optionalValues.hermes ?? []).filter(option => option.startsWith(flag));
      if (matches.length === 1) flag = matches[0];
    }
    if (blocked.has(flag)) reject();
    if (arg.startsWith("--") || !short[harness]) {
      if (harness === "codex" && flag === "--config") config(equals < 0 ? args[i + 1] ?? "" : arg.slice(equals + 1));
      const required = values[harness].includes(flag) && !(harness === "hermes" && hermesChat && flag === "--oneshot") && !(harness === "opencode" && args[i + 1]?.startsWith("-"));
      if (equals < 0 && (required || optionalValues[harness]?.includes(flag) && args[i + 1] !== undefined && !args[i + 1].startsWith("-"))) i++;
      continue;
    }
    const grammar = short[harness]!;
    for (let j = 1; j < arg.length; j++) {
      const letter = arg[j];
      if (blocked.has(`-${letter}`)) reject();
      if (grammar.required.includes(letter) || grammar.optional.includes(letter)) {
        const attached = j + 1 < arg.length;
        if (harness === "codex" && letter === "c") config(attached ? arg.slice(j + 1).replace(/^=/, "") : args[i + 1] ?? "");
        if (!attached && !(harness === "opencode" && args[i + 1]?.startsWith("-")) && (grammar.required.includes(letter) || args[i + 1] !== undefined && !args[i + 1].startsWith("-"))) i++;
        break;
      }
      if (!grammar.boolean.includes(letter)) {
        // Unknown native options remain usable separately. Their unverified
        // cluster/value grammar must not hide a profile override in the tail.
        if (arg.length > 2) throw new Error("Unknown bundled native option; pass each option and value separately to preserve the launch profile.");
        break;
      }
    }
  }
  if (harness === "dsh") dshArguments([...args]);
}
