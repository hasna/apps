import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { selectedProfileId } from "./context.js";
import { planAgentIntegration, applyAgentIntegration, inventoryNativeSkills, archiveNativeSkills, hookContextOutput, type IntegrationAgent } from "../../lib/agent-integration.js";

function agents(value: string): IntegrationAgent[] {
  if (value === "all") return ["claude", "codex"];
  if (value === "claude" || value === "codex") return [value];
  throw new Error("Supported agents: claude, codex, all");
}

export function registerAgentIntegration(parent: Command): void {
  const hook = parent.command("hook").description("Load selected Skills context through agent lifecycle hooks");
  hook.command("install")
    .option("--agent <agent>", "Agent to configure: claude, codex, all", "all")
    .option("--command <path>", "Skills executable used by the hook", "skills")
    .option("--selection-profile <id>", "Shared selection profile", "default")
    .option("--include-vendor", "Also disable discovered vendor system skills in Codex", false)
    .option("--allow-root-aliases", "Allow home .claude/.codex aliases to existing directories within this home", false)
    .option("--apply", "Apply the plan, preserving prior configuration in private backups", false)
    .option("--json", "Output a receipt as JSON", false)
    .description("Plan or install prompt hooks and disable native skill invocation")
    .action(async (options) => {
      try {
        const plan = planAgentIntegration({ agents: agents(options.agent), command: options.command, profileId: options.selectionProfile, includeVendor: options.includeVendor, allowRootAliases: options.allowRootAliases });
        const result = options.apply ? applyAgentIntegration(plan) : { changed: [], backups: [] };
        // Configuration contents can include credentials. Only paths/counts leave this command.
        const receipt = { applied: options.apply, planned: plan.changes.map(change => change.path), ...result, rootAliases: plan.rootAliases ?? [], nativeSkills: plan.nativeSkills.map(entry => ({ agent: entry.agent, path: entry.path, managed: entry.managed, vendor: entry.vendor })) };
        if (options.json) await writeCliOutput(JSON.stringify(receipt));
        else await writeCliOutput(`${options.apply ? "Configured" : "Planned"} ${plan.changes.length} agent configuration change(s).${options.apply ? " Restart the agent and trust the installed hook configuration." : " Use --apply to install."}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });

  hook.command("user-prompt")
    .requiredOption("--agent <agent>", "Native payload/output adapter: claude or codex")
    .option("--selection-profile <id>", "Selection profile to load")
    .description("Read native lifecycle JSON on stdin and return selected context")
    .action(async (options) => {
      let event = "UserPromptSubmit";
      try {
        if (agents(options.agent).length !== 1) throw new Error("A hook invocation requires one agent");
        const inputText = readFileSync(0, "utf8");
        if (inputText.length > 1024 * 1024) throw new Error("Hook input is too large");
        const input = JSON.parse(inputText);
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected hook input object");
        event = input.hook_event_name ?? event;
        // Validate event before starting the context operation.
        hookContextOutput(event, { context: "" });
        if (event === "SessionStart") {
          const refresh = Bun.spawn([process.execPath, process.argv[1]!, "sync", "--selection-profile", selectedProfileId(options.selectionProfile), "--json"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
          const timer = setTimeout(() => refresh.kill("SIGKILL"), 6500);
          try {
            const [, , status] = await Promise.all([new Response(refresh.stdout).text(), new Response(refresh.stderr).text(), refresh.exited]);
            if (status !== 0) throw new Error("Session profile refresh failed");
          } finally { clearTimeout(timer); }
        }
        // Prompt selection uses the explicitly verified cache; only session start refreshes remotely.
        const args = [process.execPath, process.argv[1]!, "context", "--stdin", "--json", "--cached"];
        if (options.selectionProfile) args.push("--selection-profile", options.selectionProfile);
        const child = Bun.spawn(args, { stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
        const timer = setTimeout(() => child.kill("SIGKILL"), 6500);
        try {
          const [stdout, , status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
          if (status !== 0) throw new Error("Skills context could not be resolved");
          const result = JSON.parse(stdout);
          if (typeof result.context !== "string") throw new Error("Invalid Skills context response");
          await writeCliOutput(JSON.stringify(hookContextOutput(event, result)));
        } finally { clearTimeout(timer); }
      } catch {
        const reason = "Skills context is unavailable. Run skills sync --selection-profile <id> and skills context --stdin --json to diagnose the selected profile.";
        if (event === "UserPromptSubmit") await writeCliOutput(JSON.stringify({ decision: "block", reason }));
        else if (event === "SessionStart") await writeCliOutput(JSON.stringify({ continue: false, stopReason: reason, systemMessage: reason }));
        else await writeCliOutput(JSON.stringify({ systemMessage: reason, hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: "Required Skills context was unavailable. Report this to the parent before performing task actions." } }));
      }
    });

  const migrate = parent.command("migrate").description("Preserve and retire native agent skill copies");
  migrate.command("native")
    .option("--project <directory>", "Also inventory native skills in a project directory")
    .option("--include-unmanaged", "Archive user-authored skills as well as Skills-managed copies", false)
    .option("--allow-root-aliases", "Allow home .claude/.codex aliases to existing directories within this home", false)
    .option("--apply", "Move selected skills to private archives outside agent discovery roots", false)
    .option("--json", "Output inventory and archive receipt as JSON", false)
    .description("Inventory native skill copies; preserve complete directories before retiring them")
    .action(async (options) => {
      try {
        const inventory = inventoryNativeSkills(undefined, { projectDir: options.project, allowRootAliases: options.allowRootAliases });
        const result = options.apply ? archiveNativeSkills(inventory, { includeUnmanaged: options.includeUnmanaged, allowRootAliases: options.allowRootAliases }) : { entries: [] };
        if (options.json) await writeCliOutput(JSON.stringify({ applied: options.apply, inventory, ...result }));
        else await writeCliOutput(`${inventory.length} native skill(s) found; ${result.entries.length} archived with recovery receipts.${options.apply ? "" : " Use --apply to archive managed copies."}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
}
