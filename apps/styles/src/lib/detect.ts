import { join, dirname } from "path";
import { existsSync } from "fs";

export type AgentName = "claude" | "gemini" | "codex" | "opencode" | "pi";

export const AGENT_DIRS: Record<AgentName, string> = {
  claude: ".claude",
  gemini: ".gemini",
  codex: ".codex",
  opencode: ".opencode",
  pi: ".pi",
};

export type DetectedAgents = Record<AgentName, boolean>;

/** Walk up from cwd looking for any agent dir or .styles/ */
export function detectProjectPath(cwd?: string): string {
  const start = cwd ?? process.cwd();
  const indicators = [".styles", ...Object.values(AGENT_DIRS), "package.json"];
  let dir = start;
  for (let i = 0; i < 5; i++) {
    if (indicators.slice(0, -1).some(d => existsSync(join(dir, d)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // fallback: package.json
  dir = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/** Returns which agent config dirs exist in projectPath */
export function detectAgents(projectPath: string): DetectedAgents {
  return Object.fromEntries(
    Object.entries(AGENT_DIRS).map(([agent, dir]) => [
      agent,
      existsSync(join(projectPath, dir)),
    ])
  ) as DetectedAgents;
}

export function hasAnyAgent(projectPath: string): boolean {
  return Object.values(detectAgents(projectPath)).some(Boolean);
}

/** Returns list of detected agent names */
export function getDetectedAgentNames(projectPath: string): AgentName[] {
  const agents = detectAgents(projectPath);
  return (Object.keys(agents) as AgentName[]).filter(a => agents[a]);
}
