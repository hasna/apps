import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { REGISTRY, mcpPackages } from "../registry.js";

/**
 * Fail-closed config read: a config file that exists but cannot be read or
 * parsed is a hard error — it must NEVER be silently treated as empty and then
 * overwritten (which would destroy the operator's existing configuration).
 */
function failClosed(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

const TOOL_CONFIGS: Record<string, { label: string; candidates: Array<{ path: string; format: string; mode: string }> }> = {
  claude: {
    label: "Claude Code",
    candidates: [
      { path: join(homedir(), ".claude", "settings.json"), format: "json", mode: "json" },
      { path: join(homedir(), ".claude", "mcp.json"), format: "json", mode: "json" },
      { path: join(homedir(), ".claude", ".mcp.json"), format: "json", mode: "json" },
    ],
  },
  codex: {
    label: "Codex CLI",
    candidates: [
      { path: join(homedir(), ".codex", "config.toml"), format: "toml", mode: "toml" },
      { path: join(homedir(), ".codex", "config.json"), format: "json", mode: "codex-json" },
    ],
  },
  gemini: {
    label: "Gemini CLI",
    candidates: [
      { path: join(homedir(), ".gemini", "settings.json"), format: "json", mode: "json" },
      { path: join(homedir(), ".gemini", "mcp-config.json"), format: "json", mode: "json" },
    ],
  },
};

const SUPPORTED_TOOLS = Object.keys(TOOL_CONFIGS);

function isToolName(value: string): boolean {
  return value in TOOL_CONFIGS;
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function buildTomlServerBlock(name: string, entry: { command: string; args: string[] }): string {
  const args = entry.args.map(formatTomlString).join(", ");
  return `[mcp_servers.${name}]\ncommand = ${formatTomlString(entry.command)}\nargs = [${args}]\n`;
}

function hasTomlServer(content: string, name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\[mcp_servers\\.${escapedName}\\]\\s*$`, "m").test(content);
}

function resolveToolConfig(tool: string, pathExists: (p: string) => boolean = existsSync): {
  label: string;
  path: string;
  format: string;
  mode: string;
} {
  const config = TOOL_CONFIGS[tool];
  const existing = config.candidates.find((candidate) => pathExists(candidate.path));
  const selected = existing ?? config.candidates[0];
  return { label: config.label, ...selected };
}

function buildMcpEntries(serviceNames: string[], mode: string): Record<string, { type?: string; command: string; args: string[]; env?: object }> {
  const entries: Record<string, { type?: string; command: string; args: string[]; env?: object }> = {};
  for (const name of serviceNames) {
    const pkg = REGISTRY.find((r) => r.name === name);
    if (!pkg?.bins?.mcp) continue;
    if (mode === "codex-json") {
      entries[name] = { type: "stdio", command: pkg.bins.mcp, args: [], env: {} };
      continue;
    }
    entries[name] = { command: pkg.bins.mcp, args: [] };
  }
  return entries;
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    failClosed(`Cannot read existing config ${path}; refusing to modify it.`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      failClosed(`Config ${path} is not a JSON object; refusing to overwrite it.`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    failClosed(`Cannot parse existing config ${path} (${(err as Error).message}); refusing to overwrite it.`);
  }
}

function readText(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    failClosed(`Cannot read existing config ${path}; refusing to modify it.`);
  }
}

/**
 * Atomic write with a preimage backup: the original file is preserved as
 * `<path>.bak` before the replacement lands via temp-file rename, so a crash
 * mid-write can never truncate the operator's config and the pre-write state
 * is always recoverable.
 */
function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    copyFileSync(path, `${path}.bak`);
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

function writeJson(path: string, data: object): void {
  writeText(path, JSON.stringify(data, null, 2) + "\n");
}

function mergeWithoutOverwrite(existing: Record<string, unknown>, incoming: Record<string, unknown>): {
  merged: Record<string, unknown>;
  added: string[];
  skipped: string[];
} {
  const merged = { ...existing };
  const added: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (key in merged) {
      skipped.push(key);
    } else {
      merged[key] = value;
      added.push(key);
    }
  }
  return { merged, added, skipped };
}

function mergeTomlMcpBlocks(existingContent: string, mcpEntries: Record<string, { command: string; args: string[] }>): {
  merged: string;
  added: string[];
  skipped: string[];
} {
  let merged = existingContent.trimEnd();
  const added: string[] = [];
  const skipped: string[] = [];
  for (const [name, entry] of Object.entries(mcpEntries)) {
    if (hasTomlServer(merged, name)) {
      skipped.push(name);
      continue;
    }
    merged = `${merged}${merged.length > 0 ? `\n\n` : ""}${buildTomlServerBlock(name, entry)}`;
    added.push(name);
  }
  return { merged: merged.length > 0 ? `${merged}\n` : "", added, skipped };
}

function connectJsonTool(
  config: { label: string; path: string },
  mcpEntries: Record<string, unknown>,
  dryRun: boolean,
): void {
  const settings = readJson(config.path) as { mcpServers?: Record<string, unknown> };
  const existingServers = settings.mcpServers || {};
  const { merged, added, skipped } = mergeWithoutOverwrite(existingServers, mcpEntries);
  if (added.length === 0) {
    console.log(chalk.dim(`  ${config.label}: all ${Object.keys(mcpEntries).length} servers already configured`));
    if (skipped.length > 0) {
      console.log(chalk.dim(`  Skipped (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  if (dryRun) {
    console.log(chalk.yellow(`  [dry-run] ${config.label}: would add ${added.length} MCP servers`));
    for (const name of added) {
      const entry = mcpEntries[name] as { command: string };
      console.log(chalk.dim(`    + ${name} → ${entry.command}`));
    }
    if (skipped.length > 0) {
      console.log(chalk.dim(`  Would skip (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  settings.mcpServers = merged;
  writeJson(config.path, settings);
  console.log(chalk.green(`  ${config.label}: added ${added.length} MCP servers → ${config.path}`));
  for (const name of added) {
    const entry = mcpEntries[name] as { command: string };
    console.log(chalk.dim(`    + ${name} → ${entry.command}`));
  }
  if (skipped.length > 0) {
    console.log(chalk.dim(`  Skipped (already present): ${skipped.join(", ")}`));
  }
}

function connectTomlTool(
  config: { label: string; path: string },
  mcpEntries: Record<string, { command: string; args: string[] }>,
  dryRun: boolean,
): void {
  const existingContent = readText(config.path);
  const { merged, added, skipped } = mergeTomlMcpBlocks(existingContent, mcpEntries);
  if (added.length === 0) {
    console.log(chalk.dim(`  ${config.label}: all ${Object.keys(mcpEntries).length} servers already configured`));
    if (skipped.length > 0) {
      console.log(chalk.dim(`  Skipped (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  if (dryRun) {
    console.log(chalk.yellow(`  [dry-run] ${config.label}: would add ${added.length} MCP servers`));
    for (const name of added) {
      const entry = mcpEntries[name];
      console.log(chalk.dim(`    + ${name} → ${entry.command}`));
    }
    if (skipped.length > 0) {
      console.log(chalk.dim(`  Would skip (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  writeText(config.path, merged);
  console.log(chalk.green(`  ${config.label}: added ${added.length} MCP servers → ${config.path}`));
  for (const name of added) {
    const entry = mcpEntries[name];
    console.log(chalk.dim(`    + ${name} → ${entry.command}`));
  }
  if (skipped.length > 0) {
    console.log(chalk.dim(`  Skipped (already present): ${skipped.join(", ")}`));
  }
}

export function registerConnectCommand(program: Command): void {
  program
    .command("connect <tool>")
    .description("Auto-wire MCP servers into AI tool configs (claude, codex, gemini)")
    .option("--only <services>", "Only connect specific services (comma-separated)")
    .option("--dry-run", "Show what would be added without writing")
    .action((tool: string, opts) => {
      if (!isToolName(tool)) {
        console.error(chalk.red(`Unknown tool: ${tool}`));
        console.error(chalk.dim(`Supported tools: ${SUPPORTED_TOOLS.join(", ")}`));
        process.exit(1);
      }
      const resolvedConfig = resolveToolConfig(tool);
      const allMcpNames = mcpPackages().map((p) => p.name);
      const serviceNames = opts.only ? opts.only.split(",").map((s: string) => s.trim()).filter(Boolean) : allMcpNames;
      const invalid = serviceNames.filter((s: string) => !allMcpNames.includes(s));
      if (invalid.length > 0) {
        console.error(chalk.red(`Unknown MCP services: ${invalid.join(", ")}`));
        console.error(chalk.dim(`Available: ${allMcpNames.join(", ")}`));
        process.exit(1);
      }
      const mcpEntries = buildMcpEntries(serviceNames, resolvedConfig.mode);
      const entryCount = Object.keys(mcpEntries).length;
      if (entryCount === 0) {
        console.log(chalk.yellow("No MCP servers found for the specified services."));
        return;
      }
      console.log(chalk.bold("agency connect") + chalk.dim(` — wiring ${entryCount} MCP servers into ${resolvedConfig.label}\n`));
      console.log(chalk.dim(`  Target config: ${resolvedConfig.path}`));
      if (resolvedConfig.format === "toml") {
        connectTomlTool(resolvedConfig, mcpEntries, !!opts.dryRun);
      } else {
        connectJsonTool(resolvedConfig, mcpEntries, !!opts.dryRun);
      }
      if (!opts.dryRun) {
        console.log(chalk.bold(`\nDone!`) + chalk.dim(" Restart your AI tool to pick up the changes."));
      }
    });
}
