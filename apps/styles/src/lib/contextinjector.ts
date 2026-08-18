import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { detectAgents, type AgentName } from "./detect.js";
import type { StyleProfile } from "./profiles.js";
import type { StyleMeta } from "./registry.js";

const MARKER_START = "<!-- styles-start -->";
const MARKER_END = "<!-- styles-end -->";
// Legacy markers persisted into user MD files before the open- prefix retirement;
// still detected so existing files keep re-injecting/removing correctly.
const LEGACY_MARKER_START = "<!-- open-styles-start -->";
const LEGACY_MARKER_END = "<!-- open-styles-end -->";

// Locate the injected section, matching either the current or the legacy marker pair.
function findSectionBounds(content: string): { start: number; end: number } | null {
  let start = -1;
  let startLen = 0;
  for (const m of [MARKER_START, LEGACY_MARKER_START]) {
    const i = content.indexOf(m);
    if (i !== -1 && (start === -1 || i < start)) {
      start = i;
      startLen = m.length;
    }
  }
  if (start === -1) return null;
  let end = -1;
  let endLen = 0;
  for (const m of [MARKER_END, LEGACY_MARKER_END]) {
    const i = content.indexOf(m, start);
    if (i !== -1 && (end === -1 || i < end)) {
      end = i;
      endLen = m.length;
    }
  }
  if (end === -1 || end <= start) return null;
  return { start, end: end + endLen };
}

// Agent → MD file mapping
const AGENT_MD_FILES: Record<AgentName, string> = {
  claude: "CLAUDE.md",
  gemini: "GEMINI.md",
  codex: "AGENTS.md",
  opencode: "AGENTS.md",  // shared with codex
  pi: "PI.md",
};

export interface InjectResult {
  action: "created" | "updated" | "unchanged" | "skipped";
  path: string;
  agent: AgentName;
}

export function buildContextSection(
  profile: StyleProfile | StyleMeta,
  prefs: Array<{ key: string; value: string; scope: string }> | Record<string, string>
): string {
  const principles = ("principles" in profile && Array.isArray(profile.principles))
    ? profile.principles : [];
  const antiPatterns = ("antiPatterns" in profile && Array.isArray(profile.antiPatterns))
    ? profile.antiPatterns : [];

  // Support both array-of-prefs and plain object
  let prefMap: Record<string, string>;
  if (Array.isArray(prefs)) {
    prefMap = Object.fromEntries(prefs.map(p => [p.key, p.value]));
  } else {
    prefMap = prefs as Record<string, string>;
  }

  const prefLine = Object.keys(prefMap).length > 0
    ? `\n**Project prefs:** ${Object.entries(prefMap).map(([k, v]) => `${k}=${v}`).join(", ")}`
    : "";

  const principlesLine = principles.length > 0
    ? `\n**Principles:** ${principles.join(" · ")}` : "";
  const antiLine = antiPatterns.length > 0
    ? `\n**Anti-Patterns:** ${antiPatterns.join(" · ")}` : "";

  const displayName = "displayName" in profile ? profile.displayName : (profile as StyleMeta).displayName;

  return [
    MARKER_START,
    `## Design Style: ${displayName}`,
    "",
    "> Managed by styles. Run `styles inject-context` to update.",
    principlesLine,
    antiLine,
    prefLine,
    MARKER_END,
  ].filter(l => l !== undefined).join("\n");
}

function injectIntoFile(
  filePath: string,
  section: string,
  agent: AgentName
): InjectResult {
  let content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const existed = existsSync(filePath);

  const bounds = findSectionBounds(content);
  if (bounds) {
    content = content.slice(0, bounds.start) + section + content.slice(bounds.end);
  } else {
    content = content + (content.endsWith("\n") ? "" : "\n") + "\n" + section + "\n";
  }

  writeFileSync(filePath, content);
  return { action: existed ? "updated" : "created", path: filePath, agent };
}

export function injectIntoAgentMd(
  projectPath: string,
  agent: AgentName,
  profile: StyleProfile | StyleMeta,
  prefs: Array<{ key: string; value: string; scope: string }> | Record<string, string>
): InjectResult {
  const mdFile = AGENT_MD_FILES[agent];
  const filePath = join(projectPath, mdFile);
  const section = buildContextSection(profile, prefs);
  return injectIntoFile(filePath, section, agent);
}

export function injectIntoAllAgentMds(
  projectPath: string,
  profile: StyleProfile | StyleMeta,
  prefs: Array<{ key: string; value: string; scope: string }> | Record<string, string>
): Record<AgentName, InjectResult | null> {
  const agents = detectAgents(projectPath);
  const results: Partial<Record<AgentName, InjectResult | null>> = {};
  const writtenMdFiles = new Set<string>(); // avoid writing AGENTS.md twice

  for (const [agent, present] of Object.entries(agents) as [AgentName, boolean][]) {
    if (!present) { results[agent] = null; continue; }
    const mdFile = AGENT_MD_FILES[agent];
    if (writtenMdFiles.has(mdFile)) {
      // Already written (e.g. AGENTS.md for both codex+opencode)
      results[agent] = { action: "unchanged", path: join(projectPath, mdFile), agent };
      continue;
    }
    writtenMdFiles.add(mdFile);
    results[agent] = injectIntoAgentMd(projectPath, agent, profile, prefs);
  }

  return results as Record<AgentName, InjectResult | null>;
}

// Legacy compat: inject only into CLAUDE.md
export function injectIntoClaudeMd(
  projectPath: string,
  profile: StyleProfile | StyleMeta,
  prefs: Record<string, string>
): { action: "created" | "updated" | "unchanged"; path: string } {
  const claudeMdPath = join(projectPath, "CLAUDE.md");
  const section = buildContextSection(profile, prefs);

  let existing = "";
  if (existsSync(claudeMdPath)) {
    existing = readFileSync(claudeMdPath, "utf-8");
  }

  const bounds = findSectionBounds(existing);

  if (bounds) {
    const before = existing.slice(0, bounds.start);
    const after = existing.slice(bounds.end);
    const newContent = before + section + after;

    if (newContent === existing) {
      return { action: "unchanged", path: claudeMdPath };
    }

    writeFileSync(claudeMdPath, newContent, "utf-8");
    return { action: "updated", path: claudeMdPath };
  }

  const isNew = !existsSync(claudeMdPath);
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
  const newContent = existing + separator + section + "\n";
  writeFileSync(claudeMdPath, newContent, "utf-8");
  return { action: isNew ? "created" : "updated", path: claudeMdPath };
}

export function removeFromAgentMd(projectPath: string, agent: AgentName): { action: "removed" | "not-found"; path: string } {
  const filePath = join(projectPath, AGENT_MD_FILES[agent]);
  if (!existsSync(filePath)) return { action: "not-found", path: filePath };
  let content = readFileSync(filePath, "utf-8");
  const bounds = findSectionBounds(content);
  if (!bounds) return { action: "not-found", path: filePath };
  const before = content.slice(0, bounds.start);
  const after = content.slice(bounds.end);
  writeFileSync(filePath, (before + after).trim() + "\n");
  return { action: "removed", path: filePath };
}

export function removeFromAllAgentMds(projectPath: string): void {
  const removedFiles = new Set<string>();
  for (const agent of Object.keys(AGENT_MD_FILES) as AgentName[]) {
    const filePath = join(projectPath, AGENT_MD_FILES[agent]);
    if (!removedFiles.has(filePath)) {
      removeFromAgentMd(projectPath, agent);
      removedFiles.add(filePath);
    }
  }
}

// Legacy compat
export function removeFromClaudeMd(
  projectPath: string
): { action: "removed" | "not-found"; path: string } {
  return removeFromAgentMd(projectPath, "claude");
}
