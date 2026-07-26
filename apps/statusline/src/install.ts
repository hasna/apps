import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * `~/.claude/settings.json` — the location Claude Code reads when the session
 * is not bound to an isolated config dir. The only tree we may create.
 */
function defaultSettingsPath(env: Record<string, string | undefined>): string {
  return join(env.HOME || homedir(), ".claude", "settings.json");
}

/**
 * Settings file the running agent actually reads. When a session is bound to
 * an isolated config dir (multi-account setups export `CLAUDE_CONFIG_DIR`),
 * `~/.claude/settings.json` is never loaded — installing there wires up a
 * statusline that silently never runs.
 */
export function claudeSettingsPath(env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME || homedir();
  const raw = env.CLAUDE_CONFIG_DIR?.trim();
  if (!raw) return defaultSettingsPath(env);
  const configDir = raw === "~" || raw.startsWith("~/") ? join(home, raw.slice(1)) : raw;
  return join(configDir, "settings.json");
}

/**
 * Wire the statusline into Claude Code's user settings. Existing settings
 * are preserved; the previous file is backed up alongside it.
 *
 * `env` resolves the default target and decides whether a missing dir may be
 * created; pass the same object you would pass to `claudeSettingsPath()` so a
 * caller driving several profiles is not steered by its own shell.
 */
export function installClaude(
  settingsPath?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const target = settingsPath ?? claudeSettingsPath(env);
  const binary = Bun.which("statusline") || "statusline";
  let settings: Record<string, any> = {};
  if (existsSync(target)) {
    try {
      settings = JSON.parse(readFileSync(target, "utf8"));
    } catch (error) {
      throw new Error(`${target} is not valid JSON — fix or move it first`);
    }
    copyFileSync(target, `${target}.bak-statusline`);
  }
  // keep any other keys the host understands on the statusLine (padding, …)
  settings.statusLine = { ...settings.statusLine, type: "command", command: `${binary} render` };
  const configDir = dirname(target);
  if (!existsSync(configDir)) {
    // Creating the dir is right for a first install into the default location,
    // and only there. Any other dir — an isolated config dir, or a path handed
    // in by a caller — belongs to whoever owns that profile. If it is missing we
    // are pointed somewhere wrong, and writing would fabricate a profile tree
    // (and, driven from a registry listing, other machines' paths). The decision
    // follows the target, never the ambient env of the process installing.
    if (resolve(target) !== resolve(defaultSettingsPath(env))) {
      throw new Error(`config dir ${configDir} does not exist — create the profile first`);
    }
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(target, JSON.stringify(settings, null, 2) + "\n");
  return target;
}
