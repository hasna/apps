#!/usr/bin/env bun
import { defaultConfig, loadConfig, saveConfig, configPath } from "./config";
import { parseClaudeInput } from "./providers/claude";
import { renderLine } from "./render";
import { segments, getSegment } from "./segments";
import { installClaude } from "./install";
import pkg from "../package.json";

const [, , command = "render", ...args] = process.argv;

async function readStdinJson(): Promise<Record<string, any>> {
  try {
    const text = await Bun.stdin.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function requireKnown(ids: string[]): string[] {
  const unknown = ids.filter((id) => !getSegment(id));
  if (unknown.length) {
    console.error(`unknown segment(s): ${unknown.join(", ")}\nrun \`statusline list\` to see available segments`);
    process.exit(1);
  }
  return ids;
}

switch (command) {
  case "render": {
    const input = await readStdinJson();
    console.log(await renderLine(parseClaudeInput(input), loadConfig()));
    break;
  }

  case "list": {
    const enabled = new Set(loadConfig().segments);
    const width = Math.max(...segments.map((s) => s.id.length));
    for (const s of segments) {
      const mark = enabled.has(s.id) ? "[x]" : "[ ]";
      console.log(`  ${mark} ${s.id.padEnd(width)}  ${s.description}`);
    }
    break;
  }

  case "enable": {
    const ids = requireKnown(args);
    const cfg = loadConfig();
    for (const id of ids) if (!cfg.segments.includes(id)) cfg.segments.push(id);
    saveConfig(cfg);
    console.log(`enabled: ${ids.join(", ")}\norder: ${cfg.segments.join(", ")}`);
    break;
  }

  case "disable": {
    const ids = requireKnown(args);
    const cfg = loadConfig();
    cfg.segments = cfg.segments.filter((id) => !ids.includes(id));
    saveConfig(cfg);
    console.log(`disabled: ${ids.join(", ")}\norder: ${cfg.segments.join(", ") || "(none)"}`);
    break;
  }

  case "order": {
    const ids = requireKnown(args);
    if (!ids.length) {
      console.error("usage: statusline order <segment> [segment...]");
      process.exit(1);
    }
    const cfg = loadConfig();
    cfg.segments = ids;
    saveConfig(cfg);
    console.log(`order: ${cfg.segments.join(", ")}`);
    break;
  }

  case "separator": {
    if (!args.length) {
      console.error('usage: statusline separator " · "');
      process.exit(1);
    }
    const cfg = loadConfig();
    cfg.separator = args.join(" ");
    saveConfig(cfg);
    console.log(`separator: "${cfg.separator}"`);
    break;
  }

  case "reset": {
    saveConfig(defaultConfig());
    console.log(`reset to defaults (${configPath()})`);
    break;
  }

  case "preview": {
    const sample = {
      cwd: process.cwd(),
      model: { id: "claude-fable-5[1m]", display_name: "Fable" },
      cost: { total_cost_usd: 12.34, total_duration_ms: 5400000, total_lines_added: 42, total_lines_removed: 7 },
      version: pkg.version,
      session_id: "preview0-0000-0000-0000-000000000000",
    };
    console.log(await renderLine(parseClaudeInput(sample), loadConfig()));
    break;
  }

  case "install": {
    const target = args[0] || "claude";
    if (target !== "claude") {
      console.error(`unsupported target "${target}" — only "claude" is supported today (OpenCode has no statusline hook yet)`);
      process.exit(1);
    }
    const path = installClaude();
    console.log(`installed into ${path} — Claude Code picks it up on the next status refresh`);
    break;
  }

  case "--version":
  case "-v":
  case "version": {
    console.log(pkg.version);
    break;
  }

  default: {
    console.log(`statusline ${pkg.version} — composable statusline for AI coding agents

usage:
  statusline render              read agent JSON on stdin, print the statusline (default)
  statusline list                show all segments and which are enabled
  statusline enable <id...>      enable segments (appended to the end)
  statusline disable <id...>     disable segments
  statusline order <id...>       set the exact segment order (also defines enabled set)
  statusline separator <str>     set the separator (default " · ")
  statusline preview             render with a sample payload from the current directory
  statusline reset               restore default config
  statusline install [claude]    wire into Claude Code (~/.claude/settings.json)
  statusline version             print version

config: ${configPath()}`);
    if (command !== "help" && command !== "--help" && command !== "-h") process.exit(1);
  }
}
