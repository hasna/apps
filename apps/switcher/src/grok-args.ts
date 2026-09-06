// Grok's TUI can queue a positional prompt before a resumed session's explicit
// model switch finishes. Headless prompts are sent after that switch. Parse
// prompt sources rather than searching raw values (a prompt may contain flags).
export function validateGrokResume(args: string[]): void {
  const values = new Set([
    "--cwd", "--leader-socket", "--debug-file", "--allow", "--allowedTools",
    "--deny", "--disallowedTools", "--output-format", "--json-schema", "--model",
    "--reasoning-effort", "--effort", "--rules", "--append-system-prompt",
    "--compaction-mode", "--compaction-detail", "--system-prompt-override",
    "--system-prompt", "--session-id", "--worktree-ref", "--ref", "--agent",
    "--agents", "--tools", "--disallowed-tools", "--max-turns", "--permission-mode",
    "--background-wait-timeout", "--sandbox", "--storage-mode", "--client-identifier",
    "--hunk-tracker-mode", "--installer", "--local-workspace-attach", "--local-workspace-cwd",
  ]);
  const prompts = new Set(["--single", "--print", "--prompt-json", "--prompt-file"]);
  let resume = false, headless = false, positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") { positional ||= i + 1 < args.length; break; }
    if (arg.startsWith("--")) {
      const flag = arg.split("=", 1)[0], attached = arg.includes("=");
      if (["--resume", "--load", "--continue"].includes(flag)) resume = true;
      if (prompts.has(flag)) headless = true;
      const optionalValue = ["--resume", "--worktree", "--local-workspace"].includes(flag);
      if (!attached && (values.has(flag) || prompts.has(flag) || flag === "--load" ||
          (optionalValue && args[i + 1] !== undefined && !args[i + 1].startsWith("-")))) i++;
    } else if (arg.startsWith("-") && arg.length > 1) {
      // clap permits joined short flags and attached values, e.g. -crID or -pTEXT.
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (flag === "r" || flag === "c") resume = true;
        if (flag === "p") headless = true;
        if (["r", "p", "s", "m", "w"].includes(flag)) {
          if (j === arg.length - 1 && (["p", "s", "m"].includes(flag) ||
              (args[i + 1] !== undefined && !args[i + 1].startsWith("-")))) i++;
          break;
        }
      }
    } else positional = true;
  }
  if (resume && positional && !headless) throw new Error(
    "Grok interactive resume with an inline prompt can run before the selected model is applied. Use --resume ID -p PROMPT, or resume without a prompt and type after the session loads.",
  );
}
