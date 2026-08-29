import { defaultConfig, loadConfig, saveConfig, configPath, type StatuslineConfig } from "./config.js";
import { parseClaudeInput } from "./providers/claude.js";
import type { StatusContext } from "./providers/types.js";
import { renderLine } from "./render.js";
import { getSegment, segments } from "./segments/index.js";
import pkg from "../package.json";

export {
  sessionAccount,
  sessionAccountEmail,
  sessionConfigDir,
  sessionStateFile,
  type SessionAccount,
} from "./accounts.js";
export { defaultConfig, loadConfig, saveConfig, configPath, type StatuslineConfig } from "./config.js";
export { cacheRate, contextUsage, lastUsageBlock, type ContextUsage, type UsageBlock } from "./context-window.js";
export { compactAge, compactDuration, compactNum, money } from "./format.js";
export { gitBranch, gitProjectName, gitRoot, lastCommitEpoch, trackedLineCount } from "./git.js";
export { claudeSettingsPath, installClaude } from "./install.js";
export { codexCacheRate, latestCodexSessionPath, type TotalTokenUsage } from "./providers/codex.js";
export { opencodeCacheRate, type OpenCodeCacheRateOptions } from "./providers/opencode.js";
export { parseClaudeInput } from "./providers/claude.js";
export type { Segment, SegmentColor, StatusContext } from "./providers/types.js";
export { renderLine } from "./render.js";
export { getSegment, segments } from "./segments/index.js";

export const statuslineVersion = pkg.version;

export type SegmentInfo = {
  id: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
};

export type ConfigUpdateResult = {
  config: StatuslineConfig;
  changed: string[];
};

export function listSegments(config: StatuslineConfig = loadConfig()): SegmentInfo[] {
  const enabled = new Set(config.segments);
  return segments.map((segment) => ({
    id: segment.id,
    description: segment.description,
    defaultEnabled: segment.defaultEnabled,
    enabled: enabled.has(segment.id),
  }));
}

export function requireKnownSegments(ids: string[]): string[] {
  const unknown = ids.filter((id) => !getSegment(id));
  if (unknown.length) {
    throw new Error(`unknown segment(s): ${unknown.join(", ")}`);
  }
  return ids;
}

export function enableSegments(ids: string[], config: StatuslineConfig = loadConfig()): ConfigUpdateResult {
  requireKnownSegments(ids);
  const next = { ...config, segments: [...config.segments] };
  const changed: string[] = [];
  for (const id of ids) {
    if (!next.segments.includes(id)) {
      next.segments.push(id);
      changed.push(id);
    }
  }
  return { config: next, changed };
}

export function disableSegments(ids: string[], config: StatuslineConfig = loadConfig()): ConfigUpdateResult {
  requireKnownSegments(ids);
  const nextSegments = config.segments.filter((id) => !ids.includes(id));
  return {
    config: { ...config, segments: nextSegments },
    changed: config.segments.filter((id) => ids.includes(id)),
  };
}

export function orderSegments(ids: string[], config: StatuslineConfig = loadConfig()): ConfigUpdateResult {
  requireKnownSegments(ids);
  if (ids.length === 0) throw new Error("at least one segment id is required");
  return { config: { ...config, segments: [...ids] }, changed: [...ids] };
}

export function setSeparator(separator: string, config: StatuslineConfig = loadConfig()): ConfigUpdateResult {
  if (!separator) throw new Error("separator must be a non-empty string");
  return { config: { ...config, separator }, changed: ["separator"] };
}

export function setColors(colors: boolean, config: StatuslineConfig = loadConfig()): ConfigUpdateResult {
  return { config: { ...config, colors }, changed: ["colors"] };
}

export function resetStatuslineConfig(): StatuslineConfig {
  return defaultConfig();
}

export async function renderStatusline(
  input: Record<string, unknown> = {},
  config: StatuslineConfig = loadConfig(),
): Promise<string> {
  const provider = process.env.STATUSLINE_PROVIDER;
  if (provider === "codex" || provider === "opencode") {
    // Codex and OpenCode have no stdin statusLine payload; the env var is
    // the provider selector and the renderer runs standalone (e.g. behind a
    // wrapper). The claude stdin path is unchanged.
    const ctx: StatusContext = {
      provider,
      cwd: typeof input.cwd === "string" ? input.cwd : process.cwd(),
    };
    return renderLine(ctx, config);
  }
  return renderLine(parseClaudeInput(input as Record<string, any>), config);
}

export function sampleClaudeInput(cwd = process.cwd()): Record<string, unknown> {
  return {
    cwd,
    model: { id: "claude-fable-5[1m]", display_name: "Fable" },
    cost: { total_cost_usd: 12.34, total_duration_ms: 5_400_000, total_lines_added: 42, total_lines_removed: 7 },
    version: statuslineVersion,
    session_id: "preview0-0000-0000-0000-000000000000",
    session_name: "preview thread",
    effort: { level: "high" },
    thinking: { enabled: true },
    rate_limits: { five_hour: { used_percentage: 42 } },
  };
}

export async function previewStatusline(
  config: StatuslineConfig = loadConfig(),
  cwd = process.cwd(),
): Promise<string> {
  return renderStatusline(sampleClaudeInput(cwd), config);
}

export function saveUpdatedConfig(result: ConfigUpdateResult, path = configPath()): StatuslineConfig {
  saveConfig(result.config, path);
  return result.config;
}
