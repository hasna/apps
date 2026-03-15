// Session snapshots — capture terminal state for agent context handoff

import { loadHistory } from "./history.js";
import { bgStatus } from "./supervisor.js";
import { getEconomyStats, formatTokens } from "./economy.js";
import { listRecipes } from "./recipes/storage.js";

export interface SessionSnapshot {
  cwd: string;
  env: Record<string, string>;
  runningProcesses: { pid: number; command: string; port?: number; uptime: number }[];
  recentCommands: { cmd: string; exitCode?: boolean; summary?: string }[];
  recipes: { name: string; command: string }[];
  economy: { tokensSaved: string; tokensUsed: string };
  timestamp: number;
}

/** Capture a compact snapshot of the current terminal state */
export function captureSnapshot(): SessionSnapshot {
  // Filtered env — only relevant vars, no secrets
  const safeEnvKeys = [
    "PATH", "HOME", "USER", "SHELL", "NODE_ENV", "PWD", "LANG",
    "TERM", "EDITOR", "VISUAL",
  ];
  const env: Record<string, string> = {};
  for (const key of safeEnvKeys) {
    if (process.env[key]) env[key] = process.env[key]!;
  }

  // Running processes
  const processes = bgStatus().map(p => ({
    pid: p.pid,
    command: p.command,
    port: p.port,
    uptime: Date.now() - p.startedAt,
  }));

  // Recent commands (last 10, compressed)
  const history = loadHistory().slice(-10);
  const recentCommands = history.map(h => ({
    cmd: h.cmd,
    exitCode: h.error,
    summary: h.nl !== h.cmd ? h.nl : undefined,
  }));

  // Project recipes
  const recipes = listRecipes(process.cwd()).slice(0, 10).map(r => ({
    name: r.name,
    command: r.command,
  }));

  // Economy
  const econ = getEconomyStats();

  return {
    cwd: process.cwd(),
    env,
    runningProcesses: processes,
    recentCommands,
    recipes,
    economy: {
      tokensSaved: formatTokens(econ.totalTokensSaved),
      tokensUsed: formatTokens(econ.totalTokensUsed),
    },
    timestamp: Date.now(),
  };
}
