import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Wire the statusline into Claude Code's user settings. Existing settings
 * are preserved; the previous file is backed up alongside it.
 */
export function installClaude(settingsPath = join(homedir(), ".claude", "settings.json")): string {
  const binary = Bun.which("statusline") || "statusline";
  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    copyFileSync(settingsPath, `${settingsPath}.bak-statusline`);
  }
  settings.statusLine = { type: "command", command: `${binary} render` };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return settingsPath;
}
