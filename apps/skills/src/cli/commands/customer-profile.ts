import type { Command } from "commander";
import { getApiUrl } from "../../lib/auth-store.js";
import { RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
import { customerNamePatch } from "../../lib/remote-profile.js";
import { emitKeypressEvents, type Key } from "node:readline";

class NameInputError extends Error {}

/** OTP enters through stdin, never a new command-line credential argument. */
async function readCode(): Promise<string> {
  if (process.stdin.isTTY) throw new NameInputError("Pipe a fresh six-digit verification code when using --code-stdin.");
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (text.length > 32) throw new NameInputError("Supply only a six-digit verification code on stdin.");
  }
  const code = text.trim();
  if (!/^\d{6}$/.test(code)) throw new NameInputError("Supply only a six-digit verification code on stdin.");
  return code;
}

function promptCode(): Promise<string | null> {
  const stdin = process.stdin, output = process.stderr;
  const wasRaw = stdin.isRaw, wasFlowing = stdin.readableFlowing;
  return new Promise(resolve => {
    let value = "", settled = false;
    const finish = (answer: string | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      stdin.off("keypress", keypress); stdin.off("end", cancel); process.off("SIGINT", cancel);
      stdin.setRawMode(wasRaw); if (wasFlowing !== true) stdin.pause();
      output.write("\n");
      if (answer === null) process.exitCode = 130;
      resolve(answer);
    };
    const cancel = () => finish(null);
    const keypress = (text: string, key: Key) => {
      if ((key.ctrl && ["c", "d"].includes(key.name ?? "")) || key.name === "escape") return cancel();
      if (key.name === "return" || key.name === "enter") {
        if (value.length === 6) return finish(value);
        output.write("\nEnter all six digits: "); value = ""; return;
      }
      if (key.name === "backspace") {
        if (value) { value = value.slice(0, -1); output.write("\b \b"); }
      } else if (/^[0-9]$/.test(text) && value.length < 6) { value += text; output.write("*"); }
    };
    const timer = setTimeout(cancel, 5 * 60 * 1000);
    emitKeypressEvents(stdin); stdin.setRawMode(true);
    stdin.on("keypress", keypress); stdin.once("end", cancel); process.once("SIGINT", cancel);
    output.write("Enter the six-digit code sent to your email: "); stdin.resume();
  });
}

export function registerCustomerProfileCommands(program: Command) {
  const commands = [
    { kind: "account", command: program.command("account").description("Manage your account on the selected Skills server").command("update") },
    { kind: "workspace", command: program.command("workspace").description("Manage the current workspace on the selected Skills server").command("update") },
  ] as const;
  for (const { kind, command } of commands) {
    command.allowExcessArguments(false)
      .description(kind === "account" ? "Update your display name with fresh email verification" : "Update the current workspace name as an owner or admin")
      .requiredOption(kind === "account" ? "--display-name <name>" : "--name <name>", "New name (1–100 characters)")
      .requiredOption("--email <email>", "Account email for fresh verification")
      .option("--code-stdin", "Read a previously requested six-digit verification code from stdin")
      .option("--json", "Output JSON")
      .action(async (options: { email: string; displayName?: string; name?: string; json?: boolean; codeStdin?: boolean }) => {
        try {
          const client = new RemoteSkillsAuthClient(getApiUrl(`Update ${kind} name`));
          customerNamePatch(kind === "account" ? { displayName: options.displayName } : { name: options.name }, kind === "account" ? "displayName" : "name");
          if (!options.codeStdin && (options.json || !process.stdin.isTTY || !process.stderr.isTTY)) {
            throw new NameInputError("Use --code-stdin with a fresh verification code for JSON or noninteractive updates.");
          }
          let code: string | null;
          if (options.codeStdin) code = await readCode();
          else { await client.requestCode(options.email); code = await promptCode(); }
          if (code === null) return;
          const result = kind === "account"
            ? await client.updateProfile(options.email, code, { displayName: options.displayName! })
            : await client.updateCurrentWorkspace(options.email, code, { name: options.name! });
          if (options.json) console.log(JSON.stringify(result));
          else console.log(kind === "account" ? "Display name saved." : "Workspace name saved.");
        } catch (error) {
          // Auth server bodies can contain arbitrary text. Never print a code,
          // session, response body or supplied value on these credential paths.
          const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
          const message = error instanceof NameInputError ? error.message
            : `Unable to update ${kind} name${status ? ` (HTTP ${status})` : ""}. Check the selected server, name, permissions and fresh verification code.`;
          if (options.json) console.log(JSON.stringify({ error: message })); else console.error(message);
          process.exitCode = 1;
        }
      });
  }
}
