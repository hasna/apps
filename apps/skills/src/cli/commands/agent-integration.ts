import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { type ReviewedDiscoveryInputs } from "../../lib/agent-discovery.js";
import { normalizeHermesHookInput, assertHermesTool } from "../../lib/agent-hermes.js";
import { selectedProfileId } from "./context.js";
import { AGENT_ADAPTERS, INTEGRATION_AGENTS, normalizeAgentHookEvent } from "../../lib/agent-adapters.js";
import { planAgentIntegration, applyAgentIntegration, inventoryNativeSkills, archiveNativeSkills, assertManagedAgentBridge, hookContextOutput, normalizeAgentHookPrompt, type IntegrationAgent } from "../../lib/agent-integration.js";
import { enrollCodexNativeHooks } from "../../lib/agent-codex-trust.js";

const RECOVERABLE_CONTEXT_CACHE_ERRORS = new Set(["CACHED_PROFILE_EXPIRED", "CACHED_PROFILE_MISSING", "CACHED_BUNDLE_MISSING"]);

async function contextForHook(input: unknown, profileId: string, cached: boolean, deadline: number): Promise<any> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Skills hook deadline exceeded");
  const args = [process.execPath, process.argv[1]!, "context", "--stdin", "--json", "--selection-profile", profileId];
  if (cached) args.push("--cached");
  const child = Bun.spawn(args, { stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  const timer = setTimeout(() => child.kill("SIGKILL"), Math.min(6500, remaining));
  let result: any;
  let status: number;
  try {
    const [stdout, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    status = exitCode;
    result = JSON.parse(stdout);
  } finally { clearTimeout(timer); }
  if (status !== 0) {
    // An expired pin overrides a newly synced profile. Reauthorize this exact
    // session through the API; do not reset its versions or forge a fresh cache
    // timestamp. Authentication/integrity failures never fall back to a cache.
    if (cached && RECOVERABLE_CONTEXT_CACHE_ERRORS.has(result?.error?.code)) {
      return contextForHook(input, profileId, false, deadline);
    }
    throw new Error("Skills context could not be resolved");
  }
  if (typeof result?.context !== "string") throw new Error("Invalid Skills context response");
  return result;
}

function agents(value: string): IntegrationAgent[] {
  if (value === "all") return [...INTEGRATION_AGENTS];
  if (INTEGRATION_AGENTS.includes(value as IntegrationAgent)) return [value as IntegrationAgent];
  throw new Error(`Supported agents: ${INTEGRATION_AGENTS.join(", ")}, all`);
}

export function registerAgentIntegration(parent: Command): void {
  const hook = parent.command("hook").description("Load selected Skills context through agent lifecycle hooks");
  hook.command("agents").option("--json", "Output the adapter capability inventory", false)
    .description("Show maintained native adapters and explicit coverage limits")
    .action(async () => { await writeCliOutput(JSON.stringify({ agents: INTEGRATION_AGENTS.map(agent => ({ agent, bridge: true, ...AGENT_ADAPTERS[agent] })), inventoryOnly: ["codewith", "windsurf", "pi", "amp", "cline", "roo", "copilot"], limitations: ["Cursor prompt hooks gate submission; selected context is injected at session start only.", "Native discovery checks cover known home roots and current project ancestors. External plugin hook injection and arbitrary added directories require separate review.", "Hermes injects selected prompt context, but native pre_llm_call fails open. Exact native hook trust, bundled reseeding opt-out, native payload retirement and a supervised pre-tool guard are required. Child failures block explicitly; native host/supervisor death is not a universal fail-closed guarantee.", "Restart agents and use their normal hook trust controls after installation."] }, null, 2)); });
  hook.command("install")
    .option("--agent <agent>", `Agent to configure: ${INTEGRATION_AGENTS.join(", ")}, all`, "all")
    .option("--command <path>", "Skills executable used by the hook", "skills")
    .option("--selection-profile <id>", "Shared selection profile", "default")
    .option("--include-vendor", "Retained for compatibility; vendor system skills are always inventoried and disabled", false)
    .option("--discovery-inputs <file>", "Advanced reviewed active plugin roots and source hashes for unsupported registrations")
    .option("--allow-root-aliases", "Allow home .claude/.codex aliases to existing directories within this home", false)
    .option("--apply", "Apply the plan, preserving prior configuration in private backups", false)
    .option("--json", "Output a receipt as JSON", false)
    .description("Plan or install one Skills CLI bridge plus native prompt hooks")
    .action(async (options) => {
      try {
        const discoveryInputs: ReviewedDiscoveryInputs | undefined = options.discoveryInputs ? JSON.parse(readFileSync(options.discoveryInputs, "utf8")) : undefined;
        const plan = planAgentIntegration({ agents: agents(options.agent), command: options.command, profileId: options.selectionProfile, includeVendor: options.includeVendor, discoveryInputs, allowRootAliases: options.allowRootAliases });
        const result = options.apply ? applyAgentIntegration(plan) : { changed: [], backups: [] };
        // Configuration contents can include credentials. Only paths/counts leave this command.
        const receipt = { applied: options.apply, planned: plan.changes.map(change => change.path), ...result, rootAliases: plan.rootAliases ?? [], discovery: plan.discoveryAfter, nativeSkills: plan.nativeSkills.map(entry => ({ agent: entry.agent, path: entry.path, managed: entry.managed, vendor: entry.vendor, system: entry.system === true, bridge: entry.bridge === true })), requiresNativeRetirement: plan.nativeSkills.some(entry => !entry.bridge && !entry.system) };
        if (options.json) await writeCliOutput(JSON.stringify(receipt));
        else await writeCliOutput(`${options.apply ? "Configured" : "Planned"} ${plan.changes.length} agent configuration change(s).${options.apply ? " Restart the agent and trust the installed hook configuration." : " Use --apply to install."}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });

  hook.command("trust")
    .requiredOption("--agent <agent>", "Native trust adapter (codex)")
    .option("--codex-command <path>", "Installed Codex executable used for its native configuration API", "codex")
    .option("--apply", "Enable and trust only the exact managed Skills hook identities", false)
    .option("--plan-digest <sha256>", "Exact reviewed dry-run digest required with --apply")
    .option("--json", "Output the native trust plan or receipt", false)
    .description("Plan or enroll exact Skills hooks through Codex native trust controls")
    .action(async (options) => {
      try {
        if (options.agent !== "codex") throw new Error("Native trust enrollment currently supports --agent codex only");
        const result = await enrollCodexNativeHooks({ codexCommand: options.codexCommand, apply: options.apply, reviewedPlanDigest: options.planDigest });
        if (options.json) await writeCliOutput(JSON.stringify(result));
        else await writeCliOutput(result.applied
          ? `Enrolled ${result.planned.length} Skills hook(s) for new Codex processes. Existing sessions were not reloaded; use their native hook controls.`
          : result.planned.length ? `Planned ${result.planned.length} native hook trust change(s). Review the --json plan, then use --apply --plan-digest ${result.planDigest}.` : "The managed Skills hooks are enabled and trusted for new Codex processes. Existing session dispatch was not checked.");
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });

  hook.command("user-prompt")
    .requiredOption("--agent <agent>", `Native payload/output adapter: ${INTEGRATION_AGENTS.join(", ")}`)
    .option("--event <event>", "Native lifecycle event supplied by the installed adapter")
    .option("--selection-profile <id>", "Selection profile to load")
    .description("Read native lifecycle JSON on stdin and return selected context")
    .action(async (options) => {
      const deadline = Date.now() + 12_000;
      // The installed blocking event must survive malformed JSON/input too.
      let event = options.agent === "hermes" && options.event === "pre_tool_call" ? "pre_tool_call" : "UserPromptSubmit";
      try {
        if (agents(options.agent).length !== 1) throw new Error("A hook invocation requires one agent");
        const inputText = readFileSync(0, "utf8");
        if (inputText.length > 1024 * 1024) throw new Error("Hook input is too large");
        let input = JSON.parse(inputText);
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected hook input object");
        const nativeEvent = options.event ?? input.hook_event_name ?? event;
        if (options.agent === "hermes") input = normalizeHermesHookInput({ ...input, hook_event_name: nativeEvent });
        event = options.agent === "hermes" ? input.hook_event_name : normalizeAgentHookEvent(options.agent, nativeEvent);
        input.hook_event_name = event;
        const projects: string[] = [process.cwd()];
        if (input.cwd !== undefined) {
          if (typeof input.cwd !== "string" || !isAbsolute(input.cwd) || input.cwd.includes("\0")) throw new Error("Invalid native hook working directory");
          projects.push(input.cwd);
        }
        if (options.agent === "cursor") {
          if (!Array.isArray(input.workspace_roots) || input.workspace_roots.length > 32 || input.workspace_roots.some((path: unknown) => typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))) throw new Error("Invalid Cursor workspace roots");
          projects.push(...input.workspace_roots);
          input.cwd ??= input.workspace_roots[0] ?? process.cwd();
          input.session_id ??= input.conversation_id;
        }
        const selectionProfile = selectedProfileId(options.selectionProfile);
        if (options.agent === "hermes" && event === "pre_tool_call") {
          assertManagedAgentBridge("hermes", { projectDirs: projects, profileId: selectionProfile });
          assertHermesTool(input);
          await writeCliOutput(JSON.stringify({ action: "continue" }));
          return;
        }
        if ((options.agent === "claude" && event === "PreToolUse") || (options.agent === "gemini" && event === "BeforeTool")) {
          assertManagedAgentBridge(options.agent, { projectDirs: projects, profileId: selectionProfile });
          const skill = options.agent === "claude" ? input.tool_input?.skill : input.tool_input?.name;
          if (skill !== "skills-cli") throw new Error("NATIVE_SKILL_DRIFT: invoke only skills-cli; load selected payload instructions with skills load");
          await writeCliOutput(JSON.stringify(options.agent === "claude" ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "Verified Skills CLI bridge" } } : {}));
          return;
        }
        // Validate event before starting the context operation.
        hookContextOutput(event, { context: "" });
        assertManagedAgentBridge(options.agent, { projectDirs: projects, profileId: selectionProfile });
        if (typeof input.prompt === "string") input.prompt = normalizeAgentHookPrompt(options.agent, nativeEvent, input.prompt);
        if (event === "SessionStart") {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error("Skills hook deadline exceeded");
          const refresh = Bun.spawn([process.execPath, process.argv[1]!, "sync", "--selection-profile", selectionProfile, "--json"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
          const timer = setTimeout(() => refresh.kill("SIGKILL"), Math.min(6500, remaining));
          try {
            const [, , status] = await Promise.all([new Response(refresh.stdout).text(), new Response(refresh.stderr).text(), refresh.exited]);
            if (status !== 0) throw new Error("Session profile refresh failed");
          } finally { clearTimeout(timer); }
        }
        // Fresh cached context stays local. An expired session can override the
        // profile refreshed above, so resolve it once through the API if needed.
        const result = await contextForHook(input, selectionProfile, true, deadline);
        const output = hookContextOutput(event, result) as { hookSpecificOutput?: { hookEventName: string; additionalContext: string } };
        if (options.agent === "hermes") {
          await writeCliOutput(JSON.stringify({ context: output.hookSpecificOutput?.additionalContext ?? "" }));
        } else if (options.agent === "cursor") {
          await writeCliOutput(JSON.stringify(event === "SessionStart" ? { additional_context: output.hookSpecificOutput?.additionalContext ?? "" } : { continue: true }));
        } else {
          if (options.agent === "gemini" && output.hookSpecificOutput) output.hookSpecificOutput.hookEventName = nativeEvent;
          await writeCliOutput(JSON.stringify(output));
        }
      } catch (error) {
        const reason = error instanceof Error && error.message.startsWith("NATIVE_SKILL_DRIFT:")
          ? error.message
          : "Skills context is unavailable. Run skills sync --selection-profile <id> and skills context --stdin --json to diagnose the selected profile.";
        if (options.agent === "hermes") {
          // pre_llm_call is non-blocking in Hermes. Make the refusal visible;
          // pre_tool_call has native fail_closed and uses the blocking shape.
          await writeCliOutput(JSON.stringify(event === "pre_tool_call" ? { action: "block", message: reason } : { context: `Required Skills context is unavailable. ${reason} Do not substitute native skill payloads; stop and repair the bridge before task actions.` }));
        } else if (options.agent === "claude" && event === "PreToolUse") await writeCliOutput(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
        else if (options.agent === "cursor") await writeCliOutput(JSON.stringify({ continue: false, user_message: reason }));
        else if (options.agent === "gemini") await writeCliOutput(JSON.stringify({ decision: "deny", continue: false, reason }));
        else if (event === "UserPromptSubmit") await writeCliOutput(JSON.stringify({ decision: "block", reason }));
        else if (event === "SessionStart") await writeCliOutput(JSON.stringify({ continue: false, stopReason: reason, systemMessage: reason }));
        else await writeCliOutput(JSON.stringify({ systemMessage: reason, hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: "Required Skills context was unavailable. Report this to the parent before performing task actions." } }));
      }
    });

  const migrate = parent.command("migrate").description("Preserve and retire native agent skill copies");
  migrate.command("native")
    .option("--project <directory>", "Also inventory a project and its ancestors (the current directory and its ancestors are always included)")
    .option("--include-unmanaged", "Archive user-authored skills as well as Skills-managed copies", false)
    .option("--include-vendor", "Retire vendor SKILL.md discovery files while preserving plugin scripts and assets", false)
    .option("--discovery-inputs <file>", "Advanced reviewed active plugin roots and source hashes")
    .option("--allow-root-aliases", "Allow home .claude/.codex aliases to existing directories within this home", false)
    .option("--apply", "Move selected skills to private archives outside agent discovery roots", false)
    .option("--json", "Output inventory and archive receipt as JSON", false)
    .description("Inventory native skill copies; preserve complete directories before retiring them")
    .action(async (options) => {
      try {
        const discoveryInputs: ReviewedDiscoveryInputs | undefined = options.discoveryInputs ? JSON.parse(readFileSync(options.discoveryInputs, "utf8")) : undefined;
        const inventory = inventoryNativeSkills(undefined, { projectDirs: [process.cwd(), ...(options.project ? [options.project] : [])], includeVendor: options.includeVendor, configured: options.includeVendor, discoveryInputs, allowRootAliases: options.allowRootAliases });
        const result = options.apply ? archiveNativeSkills(inventory, { includeUnmanaged: options.includeUnmanaged, includeVendor: options.includeVendor, allowRootAliases: options.allowRootAliases }) : { entries: [] };
        if (options.json) await writeCliOutput(JSON.stringify({ applied: options.apply, inventory, ...result }));
        else await writeCliOutput(`${inventory.length} native skill(s) found; ${result.entries.length} archived with recovery receipts.${options.apply ? "" : " Use --apply to archive managed copies."}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
}
