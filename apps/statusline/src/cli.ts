#!/usr/bin/env bun
import {
  configPath,
  defaultConfig,
  disableSegments,
  enableSegments,
  installClaude,
  listSegments,
  loadConfig,
  orderSegments,
  previewStatusline,
  renderStatusline,
  saveConfig,
  setSeparator,
  statuslineVersion,
} from "./index.js";

async function readStdinJson(): Promise<Record<string, unknown>> {
  try {
    const text = await Bun.stdin.text();
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function printError(error: unknown): void {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function printSegmentError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("unknown segment")) {
    console.error(`${message}\nrun \`statusline list\` to see available segments`);
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

function help(): string {
  return `statusline ${statuslineVersion} — composable statusline for AI coding agents

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

config: ${configPath()}`;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const [command = "render", ...args] = argv;

  try {
    switch (command) {
      case "render": {
        console.log(await renderStatusline(await readStdinJson(), loadConfig()));
        return;
      }

      case "list": {
        const rows = listSegments(loadConfig());
        const width = Math.max(...rows.map((segment) => segment.id.length));
        for (const segment of rows) {
          const mark = segment.enabled ? "[x]" : "[ ]";
          console.log(`  ${mark} ${segment.id.padEnd(width)}  ${segment.description}`);
        }
        return;
      }

      case "enable": {
        let result;
        try {
          result = enableSegments(args, loadConfig());
        } catch (error) {
          printSegmentError(error);
          return;
        }
        saveConfig(result.config);
        console.log(`enabled: ${args.join(", ")}\norder: ${result.config.segments.join(", ")}`);
        return;
      }

      case "disable": {
        let result;
        try {
          result = disableSegments(args, loadConfig());
        } catch (error) {
          printSegmentError(error);
          return;
        }
        saveConfig(result.config);
        console.log(`disabled: ${args.join(", ")}\norder: ${result.config.segments.join(", ") || "(none)"}`);
        return;
      }

      case "order": {
        if (!args.length) throw new Error("usage: statusline order <segment> [segment...]");
        let result;
        try {
          result = orderSegments(args, loadConfig());
        } catch (error) {
          printSegmentError(error);
          return;
        }
        saveConfig(result.config);
        console.log(`order: ${result.config.segments.join(", ")}`);
        return;
      }

      case "separator": {
        if (!args.length) throw new Error('usage: statusline separator " · "');
        const result = setSeparator(args.join(" "), loadConfig());
        saveConfig(result.config);
        console.log(`separator: "${result.config.separator}"`);
        return;
      }

      case "reset": {
        saveConfig(defaultConfig());
        console.log(`reset to defaults (${configPath()})`);
        return;
      }

      case "preview": {
        console.log(await previewStatusline(loadConfig(), process.cwd()));
        return;
      }

      case "install": {
        const target = args[0] || "claude";
        if (target !== "claude") {
          throw new Error(`unsupported target "${target}" — only "claude" is supported today (OpenCode has no statusline hook yet)`);
        }
        const path = installClaude();
        console.log(`installed into ${path} — Claude Code picks it up on the next status refresh`);
        return;
      }

      case "--version":
      case "-v":
      case "version": {
        console.log(statuslineVersion);
        return;
      }

      case "help":
      case "--help":
      case "-h": {
        console.log(help());
        return;
      }

      default: {
        console.log(help());
        process.exitCode = 1;
      }
    }
  } catch (error) {
    printError(error);
  }
}

if (import.meta.main) {
  await runCli();
}
