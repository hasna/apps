import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { detectAgents, AGENT_DIRS, type AgentName } from "./detect.js";

const HOOK_MARKER = "open-styles-hook";
const HOOK_COMMAND_TEMPLATE = (fileVar: string) =>
  `styles check-file "${fileVar}" --quiet || true`;

export interface InjectResult {
  success: boolean;
  settingsPath: string;
  alreadyInstalled: boolean;
  agent: AgentName;
}

// Per-agent hook injection implementations

function injectClaudeHook(projectPath: string): InjectResult {
  const settingsPath = join(projectPath, ".claude", "settings.json");
  mkdirSync(join(projectPath, ".claude"), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}
  }
  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const preToolUse = (hooks.PreToolUse as unknown[] | undefined) ?? [];
  const alreadyInstalled = preToolUse.some((h: unknown) => (h as Record<string,unknown>)._marker === HOOK_MARKER);
  if (!alreadyInstalled) {
    preToolUse.push({ matcher: "Write|Edit", type: "command", command: HOOK_COMMAND_TEMPLATE('$CLAUDE_TOOL_INPUT_FILE_PATH'), _marker: HOOK_MARKER });
    settings.hooks = { ...hooks, PreToolUse: preToolUse };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { success: true, settingsPath, alreadyInstalled, agent: "claude" };
}

function injectGeminiHook(projectPath: string): InjectResult {
  const settingsPath = join(projectPath, ".gemini", "settings.json");
  mkdirSync(join(projectPath, ".gemini"), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}
  }
  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const preToolCall = (hooks.preToolCall as unknown[] | undefined) ?? [];
  const alreadyInstalled = preToolCall.some((h: unknown) => (h as Record<string,unknown>)._marker === HOOK_MARKER);
  if (!alreadyInstalled) {
    preToolCall.push({ match: { tool: "write_file|replace_in_file" }, command: HOOK_COMMAND_TEMPLATE('${filePath}'), _marker: HOOK_MARKER });
    settings.hooks = { ...hooks, preToolCall };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { success: true, settingsPath, alreadyInstalled, agent: "gemini" };
}

function injectCodexHook(projectPath: string): InjectResult {
  const configPath = join(projectPath, ".codex", "config.toml");
  mkdirSync(join(projectPath, ".codex"), { recursive: true });
  let content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const alreadyInstalled = content.includes(HOOK_MARKER);
  if (!alreadyInstalled) {
    content += `\n[[hooks.pre_exec]]\ncommand = "styles check-file \\"$CODEX_FILE_PATH\\" --quiet || true"\n# ${HOOK_MARKER}\n`;
    writeFileSync(configPath, content);
  }
  return { success: true, settingsPath: configPath, alreadyInstalled, agent: "codex" };
}

function injectOpencodeHook(projectPath: string): InjectResult {
  const configPath = join(projectPath, ".opencode", "config.json");
  mkdirSync(join(projectPath, ".opencode"), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { settings = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
  }
  const hooks = (settings.hooks as Record<string, unknown> | undefined) ?? {};
  const alreadyInstalled = (hooks.beforeFileWrite as Record<string,unknown> | undefined)?._marker === HOOK_MARKER;
  if (!alreadyInstalled) {
    settings.hooks = { ...hooks, beforeFileWrite: { command: HOOK_COMMAND_TEMPLATE('${file}'), _marker: HOOK_MARKER } };
    writeFileSync(configPath, JSON.stringify(settings, null, 2));
  }
  return { success: true, settingsPath: configPath, alreadyInstalled, agent: "opencode" };
}

function injectPiHook(projectPath: string): InjectResult {
  const configPath = join(projectPath, ".pi", "config.json");
  mkdirSync(join(projectPath, ".pi"), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { settings = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
  }
  const hooks = (settings.hooks as Record<string, unknown> | undefined) ?? {};
  const alreadyInstalled = (hooks.preWrite as Record<string,unknown> | undefined)?._marker === HOOK_MARKER;
  if (!alreadyInstalled) {
    settings.hooks = { ...hooks, preWrite: { command: HOOK_COMMAND_TEMPLATE('${file}'), _marker: HOOK_MARKER } };
    writeFileSync(configPath, JSON.stringify(settings, null, 2));
  }
  return { success: true, settingsPath: configPath, alreadyInstalled, agent: "pi" };
}

const INJECTORS: Record<AgentName, (p: string) => InjectResult> = {
  claude: injectClaudeHook,
  gemini: injectGeminiHook,
  codex: injectCodexHook,
  opencode: injectOpencodeHook,
  pi: injectPiHook,
};

export function injectStyleHook(projectPath: string, agent: AgentName = "claude"): InjectResult {
  return INJECTORS[agent](projectPath);
}

export function injectAllStyleHooks(projectPath: string): Record<AgentName, InjectResult | null> {
  const agents = detectAgents(projectPath);
  return Object.fromEntries(
    (Object.keys(agents) as AgentName[]).map(agent => [
      agent,
      agents[agent] ? INJECTORS[agent](projectPath) : null,
    ])
  ) as Record<AgentName, InjectResult | null>;
}

export function removeStyleHook(projectPath: string, agent: AgentName = "claude"): void {
  if (agent === "claude") {
    const p = join(projectPath, ".claude", "settings.json");
    if (!existsSync(p)) return;
    const s = JSON.parse(readFileSync(p, "utf-8"));
    if (s.hooks?.PreToolUse) {
      s.hooks.PreToolUse = s.hooks.PreToolUse.filter((h: Record<string,unknown>) => h._marker !== HOOK_MARKER);
    }
    writeFileSync(p, JSON.stringify(s, null, 2));
  } else if (agent === "gemini") {
    const p = join(projectPath, ".gemini", "settings.json");
    if (!existsSync(p)) return;
    const s = JSON.parse(readFileSync(p, "utf-8"));
    if (s.hooks?.preToolCall) {
      s.hooks.preToolCall = s.hooks.preToolCall.filter((h: Record<string,unknown>) => h._marker !== HOOK_MARKER);
    }
    writeFileSync(p, JSON.stringify(s, null, 2));
  } else if (agent === "codex") {
    const p = join(projectPath, ".codex", "config.toml");
    if (!existsSync(p)) return;
    const lines = readFileSync(p, "utf-8").split("\n");
    // Remove the [[hooks.pre_exec]] block containing our marker
    const filtered: string[] = [];
    let skip = false;
    for (const line of lines) {
      if (line.trim() === "[[hooks.pre_exec]]") { skip = false; }
      if (line.includes(HOOK_MARKER)) { skip = true; filtered.pop(); filtered.pop(); continue; }
      if (!skip) filtered.push(line);
    }
    writeFileSync(p, filtered.join("\n"));
  } else {
    // opencode / pi — remove hooks.beforeFileWrite or hooks.preWrite
    const key = agent === "opencode" ? "beforeFileWrite" : "preWrite";
    const dir = agent === "opencode" ? ".opencode" : ".pi";
    const p = join(projectPath, dir, "config.json");
    if (!existsSync(p)) return;
    const s = JSON.parse(readFileSync(p, "utf-8"));
    if (s.hooks?.[key]?._marker === HOOK_MARKER) delete s.hooks[key];
    writeFileSync(p, JSON.stringify(s, null, 2));
  }
}

export function removeAllStyleHooks(projectPath: string): void {
  const agents = detectAgents(projectPath);
  for (const [agent, present] of Object.entries(agents)) {
    if (present) removeStyleHook(projectPath, agent as AgentName);
  }
}

export function isHookInstalled(projectPath: string, agent: AgentName = "claude"): boolean {
  try {
    const result = INJECTORS[agent](projectPath);
    if (result.alreadyInstalled) return true;
    // We just injected — undo it
    removeStyleHook(projectPath, agent);
    return false;
  } catch { return false; }
}

export function getInstalledAgentHooks(projectPath: string): AgentName[] {
  return (Object.keys(AGENT_DIRS) as AgentName[]).filter(a =>
    existsSync(join(projectPath, AGENT_DIRS[a])) && isHookInstalled(projectPath, a)
  );
}

export function getClaudeSettingsPath(projectPath: string): string {
  return join(projectPath, ".claude", "settings.json");
}
