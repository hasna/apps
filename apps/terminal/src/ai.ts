import Anthropic from "@anthropic-ai/sdk";
import type { Permissions } from "./history.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(perms: Permissions): string {
  const restrictions: string[] = [];
  if (!perms.destructive)
    restrictions.push("- NEVER generate commands that delete, remove, or overwrite files/data (rm, rmdir, truncate, DROP TABLE, etc.)");
  if (!perms.network)
    restrictions.push("- NEVER generate commands that make network requests (curl, wget, ssh, scp, ping, nc, etc.)");
  if (!perms.sudo)
    restrictions.push("- NEVER generate commands that use sudo or require root privileges");
  if (!perms.write_outside_cwd)
    restrictions.push("- NEVER generate commands that write to paths outside the current working directory");
  if (!perms.install)
    restrictions.push("- NEVER generate commands that install packages (brew install, npm install -g, pip install, apt install, etc.)");

  const restrictionBlock =
    restrictions.length > 0
      ? `\n\nCURRENT RESTRICTIONS (respect these absolutely):\n${restrictions.join("\n")}\nIf the user asks for something restricted, output exactly: BLOCKED: <reason>`
      : "";

  return `You are a terminal assistant. The user will describe what they want to do in plain English.
Your job is to output ONLY the exact shell command(s) to accomplish this — nothing else.
No explanation. No markdown. No backticks. Just the raw command.
If multiple commands are needed, join them with && or use a newline.
Assume macOS/Linux zsh environment.${restrictionBlock}`;
}

/** Regex patterns for permission checks — fast local guard before even calling AI */
const DESTRUCTIVE_PATTERNS = [/\brm\b/, /\brmdir\b/, /\btruncate\b/, /\bdrop\s+table\b/i, /\bdelete\s+from\b/i];
const NETWORK_PATTERNS = [/\bcurl\b/, /\bwget\b/, /\bssh\b/, /\bscp\b/, /\bping\b/, /\bnc\b/, /\bnetcat\b/];
const SUDO_PATTERNS = [/\bsudo\b/];
const INSTALL_PATTERNS = [/\bbrew\s+install\b/, /\bnpm\s+install\s+-g\b/, /\bpip\s+install\b/, /\bapt\s+install\b/, /\byum\s+install\b/];
const WRITE_OUTSIDE_PATTERNS = [/\s(\/etc|\/usr|\/var|\/opt|\/root|~\/[^.])/, />\s*\//];

export function checkPermissions(command: string, perms: Permissions): string | null {
  if (!perms.destructive && DESTRUCTIVE_PATTERNS.some((r) => r.test(command)))
    return "destructive commands are disabled in your permissions";
  if (!perms.network && NETWORK_PATTERNS.some((r) => r.test(command)))
    return "network commands are disabled in your permissions";
  if (!perms.sudo && SUDO_PATTERNS.some((r) => r.test(command)))
    return "sudo is disabled in your permissions";
  if (!perms.install && INSTALL_PATTERNS.some((r) => r.test(command)))
    return "package installation is disabled in your permissions";
  if (!perms.write_outside_cwd && WRITE_OUTSIDE_PATTERNS.some((r) => r.test(command)))
    return "writing outside cwd is disabled in your permissions";
  return null;
}

export async function translateToCommand(nl: string, perms: Permissions): Promise<string> {
  const message = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 256,
    system: buildSystemPrompt(perms),
    messages: [{ role: "user", content: nl }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  const text = block.text.trim();
  if (text.startsWith("BLOCKED:")) throw new Error(text);
  return text;
}
