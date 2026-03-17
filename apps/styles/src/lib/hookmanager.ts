import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getDb } from "./db.js";

export interface InjectResult {
  success: boolean;
  settingsPath: string;
  alreadyInstalled: boolean;
}

// ── The hook command injected into Claude's PreToolUse ────────────────────────

const HOOK_COMMAND =
  'styles check-file "$CLAUDE_TOOL_INPUT_FILE_PATH" --project "$PWD" --quiet || true';

const HOOK_MATCHER = "Write|Edit";

const STYLES_HOOK_MARKER = "open-styles-hook";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getClaudeSettingsPath(projectPath: string): string {
  return join(projectPath, ".claude", "settings.json");
}

interface ClaudeHookEntry {
  type?: string;
  command?: string;
  matcher?: string;
  [key: string]: unknown;
}

interface ClaudeHooksConfig {
  PreToolUse?: ClaudeHookEntry[];
  PostToolUse?: ClaudeHookEntry[];
  [key: string]: unknown;
}

interface ClaudeSettings {
  hooks?: ClaudeHooksConfig;
  [key: string]: unknown;
}

function readSettings(settingsPath: string): ClaudeSettings {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeSettings(settingsPath: string, settings: ClaudeSettings): void {
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

function findHookIndex(hooks: ClaudeHookEntry[]): number {
  return hooks.findIndex(
    (h) =>
      (h.command?.includes("styles check-file") ||
        h.command?.includes(STYLES_HOOK_MARKER)) ??
      false
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isHookInstalled(projectPath: string): boolean {
  const settingsPath = getClaudeSettingsPath(projectPath);
  const settings = readSettings(settingsPath);
  const preToolUse = settings.hooks?.PreToolUse ?? [];
  return findHookIndex(preToolUse) !== -1;
}

export function injectStyleHook(projectPath: string): InjectResult {
  const settingsPath = getClaudeSettingsPath(projectPath);

  // Check if already installed
  if (isHookInstalled(projectPath)) {
    return { success: true, settingsPath, alreadyInstalled: true };
  }

  const settings = readSettings(settingsPath);

  // Ensure hooks structure exists
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

  const hookEntry: ClaudeHookEntry = {
    type: "command",
    matcher: HOOK_MATCHER,
    command: HOOK_COMMAND,
    // Marker comment so we can identify and remove this hook later
    _marker: STYLES_HOOK_MARKER,
  };

  settings.hooks.PreToolUse.push(hookEntry);

  try {
    writeSettings(settingsPath, settings);
  } catch (e) {
    return {
      success: false,
      settingsPath,
      alreadyInstalled: false,
    };
  }

  // Update project_configs to reflect hook installed state
  const db = getDb();
  const existing = db
    .query("SELECT id FROM project_configs WHERE project_path = ?")
    .get(projectPath) as { id: string } | null;

  if (existing) {
    db.run(
      "UPDATE project_configs SET hook_installed = 1 WHERE project_path = ?",
      [projectPath]
    );
  } else {
    db.run(
      `INSERT INTO project_configs (id, project_path, hook_installed, created_at)
       VALUES (?, ?, 1, ?)`,
      [crypto.randomUUID(), projectPath, Date.now()]
    );
  }

  return { success: true, settingsPath, alreadyInstalled: false };
}

export function removeStyleHook(projectPath: string): void {
  const settingsPath = getClaudeSettingsPath(projectPath);
  const settings = readSettings(settingsPath);

  const preToolUse = settings.hooks?.PreToolUse ?? [];
  const idx = findHookIndex(preToolUse);

  if (idx === -1) return; // Nothing to remove

  preToolUse.splice(idx, 1);

  if (settings.hooks) {
    settings.hooks.PreToolUse = preToolUse;
  }

  writeSettings(settingsPath, settings);

  // Update DB
  const db = getDb();
  db.run(
    "UPDATE project_configs SET hook_installed = 0 WHERE project_path = ?",
    [projectPath]
  );
}
