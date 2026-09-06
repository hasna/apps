import { dshArguments } from "./dsh-args";
import type { HarnessId } from "./harness-types";

const reserved: Record<HarnessId, readonly string[]> = {
  claude: ["--model", "--fallback-model", "--settings", "--setting-sources"],
  codex: ["--model", "-m", "--profile", "-p", "--oss", "--local-provider", "--remote", "--remote-auth-token-env"],
  grok: ["--model", "-m", "--oauth", "--leader", "--leader-socket"],
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
  dsh: ["--profile"],
  claude: ["--system-prompt", "--append-system-prompt", "--agent", "--agents", "--tools", "--allowedTools", "--disallowedTools", "--permission-mode", "--permission-prompts", "--output-format", "--input-format", "--json-schema", "--max-turns", "--max-budget-usd", "--mcp-config", "--session-id", "--plugin-dir"],
  codex: ["--config", "--image", "--sandbox", "--cd", "--add-dir", "--ask-for-approval", "--output-last-message", "--output-schema", "--color", "--enable", "--disable", "--thread-source"],
  grok: ["--single", "--print", "--prompt-file", "--prompt-json", "--load", "--cwd", "--agent", "--agents", "--allow", "--allowedTools", "--deny", "--disallowedTools", "--debug-file", "--json-schema", "--max-turns", "--output-format", "--permission-mode", "--reasoning-effort", "--effort", "--rules", "--append-system-prompt", "--system-prompt", "--system-prompt-override", "--session-id", "--sandbox", "--tools", "--disallowed-tools", "--worktree-ref", "--ref"],
  opencode2: ["--session", "--prompt", "--agent", "--format", "--file", "--title", "--log-level", "--completions"],
  pi: ["--mode", "--system-prompt", "--append-system-prompt", "--name", "--session", "--session-id", "--fork", "--session-dir", "--tools", "--exclude-tools", "--thinking", "--export", "--extension", "--skill", "--prompt-template", "--theme", "--use-theme", "--tui-mode", "-n", "-t", "-xt", "-e"],
  // Derived from OMP 18.1.11's `src/cli/flag-tables.ts` and `--help`:
  // values must be skipped even when they look like flags, while `--` ends
  // option parsing and leaves the remaining prompt literal.
  omp: ["--model", "--smol", "--slow", "--plan", "--prewalk-into", "--plan-yolo-into", "--provider", "--api-key", "--system-prompt", "--append-system-prompt", "--profile", "--cwd", "--mode", "--config", "--add-dir", "--session-dir", "--models", "--tools", "--thinking", "--service-tier", "--hook", "--extension", "-e", "--trusted-extension", "--plugin-dir", "--skills", "--export", "--max-time", "--approval-mode", "--fork", "--provider-session-id", "--prompt-cache-key"],
};
const optionalValues: Partial<Record<HarnessId, readonly string[]>> = {
  claude: ["--resume", "--continue"], grok: ["--resume", "--worktree", "--local-workspace"], pi: ["--list-models"], omp: ["--resume", "-r", "--session"],
};
// clap and Effect support short clusters. Stop at a value-taking option, so
// -pTEXT in Grok or -oFILE in Codex cannot turn text into model flags. Pi's
// multi-letter options use its own exact-token parser and are not clusters.
const short: Partial<Record<HarnessId, { required: string; optional: string; boolean: string }>> = {
  codex: { required: "cimpsCao", optional: "", boolean: "hV" },
  grok: { required: "psm", optional: "rw", boolean: "chv" },
  opencode2: { required: "smf", optional: "", boolean: "chv" },
};
const providerKeys = new Set(["model", "model_provider", "model_providers", "model_catalog_json"]);
function codexProviderOverride(value: string): boolean {
  const key = value.slice(0, value.indexOf("=") < 0 ? value.length : value.indexOf("=")).trim();
  // Match the TOML key syntax, including quoted roots, rather than looking for
  // provider words in unrelated option values such as a custom system prompt.
  try { return Object.keys(Bun.TOML.parse(`${key} = 0`)).some(root => providerKeys.has(root)); }
  catch { return /^(model|model_provider|model_providers|model_catalog_json)(?:\s*\.|\s*$)/.test(key); }
}

export function assertHarnessArguments(harness: HarnessId, args: readonly string[], options: { additionalReserved?: readonly string[]; reserveCodexConfig?: boolean } = {}): void {
  const blocked = new Set([...reserved[harness], ...options.additionalReserved ?? []]);
  const reject = (): never => { throw new Error("Provider/model configuration arguments are reserved by the launch profile; update the profile instead."); };
  const config = (value: string) => { if (harness === "codex" && (options.reserveCodexConfig || codexProviderOverride(value))) reject(); };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;
    if (!arg.startsWith("-") || arg === "-") continue;
    const equals = arg.indexOf("="), flag = equals < 0 ? arg : arg.slice(0, equals);
    if (blocked.has(flag)) reject();
    if (arg.startsWith("--") || !short[harness]) {
      if (harness === "codex" && flag === "--config") config(equals < 0 ? args[i + 1] ?? "" : arg.slice(equals + 1));
      if (equals < 0 && (values[harness].includes(flag) || optionalValues[harness]?.includes(flag) && args[i + 1] !== undefined && !args[i + 1].startsWith("-"))) i++;
      continue;
    }
    const grammar = short[harness]!;
    for (let j = 1; j < arg.length; j++) {
      const letter = arg[j];
      if (blocked.has(`-${letter}`)) reject();
      if (grammar.required.includes(letter) || grammar.optional.includes(letter)) {
        const attached = j + 1 < arg.length;
        if (harness === "codex" && letter === "c") config(attached ? arg.slice(j + 1).replace(/^=/, "") : args[i + 1] ?? "");
        if (!attached && (grammar.required.includes(letter) || args[i + 1] !== undefined && !args[i + 1].startsWith("-"))) i++;
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
