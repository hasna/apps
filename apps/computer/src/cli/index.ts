#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { runTask } from "../agent/loop.js";
import { listSessions, getSession, getActionLogs, deleteSession, getStats, searchSessions } from "../db/index.js";
import { captureScreenshot, saveScreenshotToFile } from "../drivers/mac/screenshot.js";
import { loadConfig, getConfigValue, setConfigValue, getConfigPath } from "../lib/config.js";
import { calculateCost, formatCost, stepCost } from "../lib/pricing.js";
import { registerCloudCommands } from "@hasna/cloud";
import { renderInlineImage, supportsInlineImages } from "../lib/terminal-image.js";
import type { Provider } from "../types/index.js";

const program = new Command();

program
  .name("computer")
  .description("Open-source computer use for AI agents — control your Mac with AI")
  .version("0.1.0");

// ── run ──────────────────────────────────────────────────────────────
program
  .command("run")
  .description("Run a computer use task")
  .argument("<task>", "Natural language description of the task")
  .option("-p, --provider <provider>", "AI provider (anthropic|openai)", "anthropic")
  .option("-m, --model <model>", "Model to use")
  .option("-s, --max-steps <n>", "Maximum number of steps", "50")
  .option("--save-screenshots", "Save screenshots to disk", false)
  .option("--screenshots-dir <dir>", "Directory to save screenshots")
  .option("--system-prompt <prompt>", "Custom system prompt")
  .option("--max-width <px>", "Max screenshot width for AI model (default: 1280)", "1280")
  .option("--dry-run", "Plan actions without executing them", false)
  .option("--no-preview", "Disable inline screenshot preview in terminal")
  .option("--tag <tags...>", "Tag this session (can specify multiple)")
  .option("--display <n>", "Display number to capture (1=main, 2=secondary)")
  .action(async (task: string, opts: any) => {
    const cfg = loadConfig();
    const provider = opts.provider ?? cfg.provider;
    const maxSteps = parseInt(opts.maxSteps) || cfg.maxSteps;
    const maxWidth = parseInt(opts.maxWidth) || cfg.screenshotMaxWidth;

    console.log(chalk.bold.cyan("computer") + (opts.dryRun ? chalk.yellow.bold(" [DRY RUN]") : "") + " — starting task");
    console.log(chalk.dim(`Provider: ${provider} | Max steps: ${maxSteps} | Max width: ${maxWidth}px${opts.dryRun ? " | DRY RUN" : ""}`));
    console.log(chalk.dim(`Task: ${task}`));
    console.log();

    const session = await runTask({
      task,
      provider: provider as Provider,
      model: opts.model ?? cfg.model,
      maxSteps,
      saveScreenshots: opts.saveScreenshots ?? cfg.saveScreenshots,
      screenshotsDir: opts.screenshotsDir ?? cfg.screenshotsDir,
      systemPrompt: opts.systemPrompt,
      screenshotMaxWidth: maxWidth,
      dryRun: opts.dryRun,
      tags: opts.tag,
      displayNumber: opts.display ? parseInt(opts.display) : undefined,
      onStep: (step, response, result) => {
        const status = result.success ? chalk.green("OK") : chalk.red("FAIL");
        const actionDesc = response.action
          ? `${response.action.type}${response.action.type === "click" ? ` (${(response.action as any).point.x},${(response.action as any).point.y})` : ""}`
          : "done";
        const cost = response.usage
          ? chalk.dim(` ${stepCost(opts.model ?? cfg.model ?? "claude-sonnet-4-5", response.usage.input, response.usage.output)}`)
          : "";
        console.log(
          chalk.dim(`[${String(step + 1).padStart(3)}]`) +
          ` ${status} ${chalk.yellow(actionDesc)}` +
          chalk.dim(` (${result.duration_ms}ms)`) +
          cost
        );
        if (response.reasoning) {
          const short = response.reasoning.slice(0, 120).replace(/\n/g, " ");
          console.log(chalk.dim(`      ${short}${response.reasoning.length > 120 ? "..." : ""}`));
        }
        // Inline screenshot preview (iTerm2/Kitty)
        if (opts.preview !== false && result.screenshot && supportsInlineImages()) {
          const img = renderInlineImage(result.screenshot.base64, { width: 40, height: 12 });
          if (img) process.stdout.write(img);
        }
      },
      onDone: (session) => {
        console.log();
        const totalCost = formatCost(calculateCost(session.model, session.total_tokens_in, session.total_tokens_out));
        if (session.status === "completed" && !session.error) {
          console.log(chalk.green.bold("Task completed successfully."));
        } else if (session.status === "completed" && session.error) {
          console.log(chalk.yellow.bold(`Task finished: ${session.error}`));
        } else {
          console.log(chalk.red.bold(`Task failed: ${session.error}`));
        }
        console.log(
          chalk.dim(
            `Steps: ${session.steps} | Tokens: ${(session.total_tokens_in + session.total_tokens_out).toLocaleString()} | Cost: ${totalCost} | Duration: ${(session.total_duration_ms / 1000).toFixed(1)}s`
          )
        );
        console.log(chalk.dim(`Session: ${session.id}`));
      },
    });
  });

// ── screenshot ───────────────────────────────────────────────────────
program
  .command("screenshot")
  .description("Take a screenshot of the current screen")
  .option("-o, --output <path>", "Save to file path")
  .action(async (opts: any) => {
    const ss = await captureScreenshot();
    if (opts.output) {
      const dir = opts.output.includes("/") ? opts.output.substring(0, opts.output.lastIndexOf("/")) : ".";
      const file = opts.output.includes("/") ? opts.output.substring(opts.output.lastIndexOf("/") + 1) : opts.output;
      const path = await saveScreenshotToFile(ss, dir, file);
      console.log(chalk.green(`Screenshot saved: ${path}`));
    } else {
      console.log(chalk.green(`Screenshot captured: ${ss.size.width}x${ss.size.height}`));
      console.log(chalk.dim(`Base64 length: ${ss.base64.length} chars`));
    }
  });

// ── sessions ─────────────────────────────────────────────────────────
program
  .command("sessions")
  .description("List computer use sessions")
  .option("-n, --limit <n>", "Number of sessions to show", "20")
  .option("--status <status>", "Filter by status")
  .option("--tag <tag>", "Filter by tag")
  .action(async (opts: any) => {
    const sessions = listSessions({
      limit: parseInt(opts.limit),
      status: opts.status,
      tag: opts.tag,
    });

    if (sessions.length === 0) {
      console.log(chalk.dim("No sessions found."));
      return;
    }

    for (const s of sessions) {
      const statusColor =
        s.status === "completed" ? chalk.green :
        s.status === "failed" ? chalk.red :
        s.status === "running" ? chalk.yellow : chalk.dim;

      const tagStr = s.tags?.length ? chalk.magenta(` [${s.tags.join(", ")}]`) : "";
      console.log(
        `${chalk.dim(s.id.slice(0, 8))} ${statusColor(s.status.padEnd(10))} ${chalk.cyan(s.provider.padEnd(10))} ${s.steps} steps${tagStr}  ${chalk.dim(s.created_at)}`
      );
      console.log(chalk.dim(`  ${s.task.slice(0, 100)}`));
    }
  });

// ── session ──────────────────────────────────────────────────────────
program
  .command("session")
  .description("Show details of a session")
  .argument("<id>", "Session ID (or prefix)")
  .action(async (id: string) => {
    // Support prefix matching
    const sessions = listSessions({ limit: 100 });
    const session = sessions.find((s) => s.id.startsWith(id));

    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }

    console.log(chalk.bold("Session: ") + session.id);
    console.log(chalk.bold("Task: ") + session.task);
    console.log(chalk.bold("Provider: ") + session.provider + " / " + session.model);
    console.log(chalk.bold("Status: ") + session.status);
    console.log(chalk.bold("Steps: ") + session.steps);
    console.log(chalk.bold("Tokens: ") + `${session.total_tokens_in} in / ${session.total_tokens_out} out`);
    console.log(chalk.bold("Duration: ") + `${(session.total_duration_ms / 1000).toFixed(1)}s`);
    if (session.error) console.log(chalk.bold("Error: ") + chalk.red(session.error));
    console.log(chalk.bold("Created: ") + session.created_at);
    if (session.completed_at) console.log(chalk.bold("Completed: ") + session.completed_at);

    console.log();
    console.log(chalk.bold("Action Log:"));
    const logs = getActionLogs(session.id);
    for (const log of logs) {
      const status = log.success ? chalk.green("OK") : chalk.red("FAIL");
      console.log(`  [${String(log.step + 1).padStart(3)}] ${status} ${chalk.yellow(log.action.type)} ${chalk.dim(`${log.duration_ms}ms`)}`);
      if (log.reasoning) {
        const short = log.reasoning.slice(0, 100).replace(/\n/g, " ");
        console.log(chalk.dim(`        ${short}`));
      }
      if (log.error) console.log(chalk.red(`        Error: ${log.error}`));
    }
  });

// ── delete ───────────────────────────────────────────────────────────
program
  .command("delete")
  .description("Delete a session")
  .argument("<id>", "Session ID (or prefix)")
  .action(async (id: string) => {
    const sessions = listSessions({ limit: 1000 });
    const session = sessions.find((s) => s.id.startsWith(id));
    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }
    deleteSession(session.id);
    console.log(chalk.green(`Deleted session: ${session.id}`));
  });

// ── stats ────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show usage statistics")
  .action(async () => {
    const stats = getStats();
    console.log(chalk.bold("Computer Use Stats"));
    console.log(`  Sessions:  ${stats.total_sessions} (${chalk.green(stats.completed + " completed")}, ${chalk.red(stats.failed + " failed")})`);
    console.log(`  Steps:     ${stats.total_steps}`);
    console.log(`  Tokens:    ${stats.total_tokens.toLocaleString()}`);
  });

// ── watch ────────────────────────────────────────────────────────────
program
  .command("watch")
  .description("Live-stream what the agent sees (polls running session)")
  .argument("[id]", "Session ID to watch (default: latest running)")
  .option("-i, --interval <ms>", "Poll interval in milliseconds", "500")
  .option("--no-preview", "Disable inline screenshot preview")
  .action(async (id: string | undefined, opts: any) => {
    const interval = parseInt(opts.interval);

    // Find session to watch
    let sessionId = id;
    if (!sessionId) {
      const running = listSessions({ status: "running", limit: 1 });
      if (running.length === 0) {
        console.log(chalk.yellow("No running sessions found. Start one with `computer run <task>`."));
        process.exit(0);
      }
      sessionId = running[0].id;
    } else {
      // Prefix match
      const all = listSessions({ limit: 100 });
      const match = all.find((s) => s.id.startsWith(sessionId!));
      if (match) sessionId = match.id;
    }

    console.log(chalk.bold.cyan("computer watch") + ` — session ${chalk.dim(sessionId!.slice(0, 8))}`);
    console.log(chalk.dim(`Polling every ${interval}ms. Press Ctrl+C to stop.\n`));

    let lastStep = -1;

    const poll = async () => {
      const session = getSession(sessionId!);
      if (!session) {
        console.log(chalk.red("Session not found."));
        process.exit(1);
      }

      const logs = getActionLogs(sessionId!);
      const newLogs = logs.filter((l) => l.step > lastStep);

      for (const log of newLogs) {
        const status = log.success ? chalk.green("OK") : chalk.red("FAIL");
        console.log(
          chalk.dim(`[${String(log.step + 1).padStart(3)}]`) +
          ` ${status} ${chalk.yellow(log.action.type)}` +
          chalk.dim(` (${log.duration_ms}ms)`)
        );
        if (log.reasoning) {
          const short = log.reasoning.slice(0, 120).replace(/\n/g, " ");
          console.log(chalk.dim(`      ${short}${log.reasoning.length > 120 ? "..." : ""}`));
        }
        if (log.error) {
          console.log(chalk.red(`      Error: ${log.error}`));
        }
        // Show inline screenshot if we have the path and terminal supports it
        if (opts.preview !== false && log.screenshot_path && supportsInlineImages()) {
          try {
            const { readFileSync } = await import("fs");
            const imgData = readFileSync(log.screenshot_path);
            const b64 = imgData.toString("base64");
            const img = renderInlineImage(b64, { width: 40, height: 12 });
            if (img) process.stdout.write(img);
          } catch {
            // Screenshot file may not exist
          }
        }
        lastStep = log.step;
      }

      // Check if session ended
      if (session.status !== "running") {
        console.log();
        const totalCost = formatCost(calculateCost(session.model, session.total_tokens_in, session.total_tokens_out));
        if (session.status === "completed" && !session.error) {
          console.log(chalk.green.bold("Session completed."));
        } else if (session.status === "completed") {
          console.log(chalk.yellow.bold(`Session finished: ${session.error}`));
        } else {
          console.log(chalk.red.bold(`Session ${session.status}: ${session.error}`));
        }
        console.log(
          chalk.dim(`Steps: ${session.steps} | Tokens: ${(session.total_tokens_in + session.total_tokens_out).toLocaleString()} | Cost: ${totalCost} | Duration: ${(session.total_duration_ms / 1000).toFixed(1)}s`)
        );
        process.exit(0);
      }
    };

    // Initial poll
    await poll();

    // Continue polling
    const timer = setInterval(poll, interval);

    // Clean exit on Ctrl+C
    process.on("SIGINT", () => {
      clearInterval(timer);
      console.log(chalk.dim("\nStopped watching."));
      process.exit(0);
    });

    // Keep alive
    await new Promise(() => {});
  });

// ── search ───────────────────────────────────────────────────────────
program
  .command("search")
  .description("Search sessions by task text")
  .argument("<query>", "Search query")
  .option("-n, --limit <n>", "Max results", "20")
  .action(async (query: string, opts: any) => {
    const sessions = searchSessions(query, parseInt(opts.limit));
    if (sessions.length === 0) {
      console.log(chalk.dim("No sessions found."));
      return;
    }
    for (const s of sessions) {
      const statusColor =
        s.status === "completed" ? chalk.green :
        s.status === "failed" ? chalk.red : chalk.dim;
      const tagStr = s.tags?.length ? chalk.magenta(` [${s.tags.join(", ")}]`) : "";
      console.log(
        `${chalk.dim(s.id.slice(0, 8))} ${statusColor(s.status.padEnd(10))} ${chalk.cyan(s.provider.padEnd(10))} ${s.steps} steps${tagStr}  ${chalk.dim(s.created_at)}`
      );
      console.log(chalk.dim(`  ${s.task.slice(0, 100)}`));
    }
  });

// ── config ───────────────────────────────────────────────────────────
const configCmd = program
  .command("config")
  .description("View or modify configuration");

configCmd
  .command("show")
  .description("Show current configuration")
  .action(async () => {
    const config = loadConfig();
    console.log(chalk.bold("Config: ") + getConfigPath());
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command("get")
  .description("Get a config value")
  .argument("<key>", "Config key (e.g. provider, safety.blockedApps)")
  .action(async (key: string) => {
    const value = getConfigValue(key);
    if (value === undefined) {
      console.log(chalk.red(`Key not found: ${key}`));
      process.exit(1);
    }
    console.log(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
  });

configCmd
  .command("set")
  .description("Set a config value")
  .argument("<key>", "Config key (e.g. provider, maxSteps)")
  .argument("<value>", "Value to set")
  .action(async (key: string, value: string) => {
    setConfigValue(key, value);
    console.log(chalk.green(`Set ${key} = ${value}`));
  });

configCmd
  .command("path")
  .description("Show config file path")
  .action(async () => {
    console.log(getConfigPath());
  });

configCmd
  .command("edit")
  .description("Open config in $EDITOR")
  .action(async () => {
    const editor = process.env.EDITOR ?? "nano";
    // Ensure config file exists
    const config = loadConfig();
    const { saveConfig } = await import("../lib/config.js");
    saveConfig(config);
    const proc = Bun.spawn([editor, getConfigPath()], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  });

configCmd
  .command("reset")
  .description("Reset config to defaults")
  .action(async () => {
    const { DEFAULT_CONFIG, saveConfig } = await import("../lib/config.js");
    saveConfig(DEFAULT_CONFIG);
    console.log(chalk.green("Config reset to defaults."));
  });

// ── replay ───────────────────────────────────────────────────────────
program
  .command("replay")
  .description("Replay a session — show actions and screenshots in sequence")
  .argument("<id>", "Session ID (or prefix)")
  .option("--speed <x>", "Replay speed multiplier (default: 2)", "2")
  .option("--no-preview", "Disable inline screenshot preview")
  .action(async (id: string, opts: any) => {
    const sessions = listSessions({ limit: 1000 });
    const session = sessions.find((s) => s.id.startsWith(id));
    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }

    const logs = getActionLogs(session.id);
    if (logs.length === 0) {
      console.log(chalk.dim("No action logs for this session."));
      process.exit(0);
    }

    const speed = parseFloat(opts.speed);
    const totalCost = formatCost(calculateCost(session.model, session.total_tokens_in, session.total_tokens_out));

    console.log(chalk.bold.cyan("computer replay") + ` — ${chalk.dim(session.id.slice(0, 8))}`);
    console.log(chalk.dim(`Task: ${session.task}`));
    console.log(chalk.dim(`Provider: ${session.provider} | ${logs.length} steps | Speed: ${speed}x\n`));

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const status = log.success ? chalk.green("OK") : chalk.red("FAIL");
      console.log(
        chalk.dim(`[${String(log.step + 1).padStart(3)}]`) +
        ` ${status} ${chalk.yellow(log.action.type)}` +
        chalk.dim(` (${log.duration_ms}ms)`)
      );
      if (log.reasoning) {
        const short = log.reasoning.slice(0, 120).replace(/\n/g, " ");
        console.log(chalk.dim(`      ${short}${log.reasoning.length > 120 ? "..." : ""}`));
      }
      if (log.error) {
        console.log(chalk.red(`      Error: ${log.error}`));
      }

      // Show saved screenshot if available
      if (opts.preview !== false && log.screenshot_path && supportsInlineImages()) {
        try {
          const { readFileSync } = await import("fs");
          const imgData = readFileSync(log.screenshot_path);
          const b64 = imgData.toString("base64");
          const img = renderInlineImage(b64, { width: 40, height: 12 });
          if (img) process.stdout.write(img);
        } catch {
          // Screenshot file may not exist
        }
      }

      // Delay between steps based on original timing and speed
      if (i < logs.length - 1) {
        const nextLog = logs[i + 1];
        const delay = Math.max(100, Math.round(log.duration_ms / speed));
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    console.log();
    console.log(
      chalk.dim(`Replay complete. ${logs.length} steps | Cost: ${totalCost} | Duration: ${(session.total_duration_ms / 1000).toFixed(1)}s`)
    );
  });

// ── headless ─────────────────────────────────────────────────────────
program
  .command("headless")
  .description("Check headless mode status and available strategies")
  .action(async () => {
    const { getHeadlessStatus } = await import("../drivers/mac/headless.js");
    const status = await getHeadlessStatus();

    console.log(chalk.bold("Headless Mode Status\n"));
    console.log(`  Display attached:  ${status.display ? chalk.green("yes") : chalk.red("no")}`);
    console.log(`  Screen Sharing:    ${status.screenSharing ? chalk.green("enabled") : chalk.dim("disabled")}`);
    console.log(`  Lume (CUA VMs):    ${status.lume ? chalk.green("installed") : chalk.dim("not installed")}`);
    console.log();
    console.log(status.recommendation);
  });

// ── record ───────────────────────────────────────────────────────────
program
  .command("record")
  .description("Record mouse/keyboard events as a replayable macro")
  .option("-d, --duration <seconds>", "Max recording duration in seconds", "60")
  .option("-o, --output <file>", "Save recording to JSON file")
  .action(async (opts: any) => {
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const { existsSync, writeFileSync } = await import("fs");

    // Find record helper binary
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(__dirname, "..", "..", "helpers", "record"),
      join(__dirname, "..", "helpers", "record"),
      join(process.env.HOME ?? "~", ".hasna", "computer", "helpers", "record"),
    ];
    const helperPath = candidates.find((c) => existsSync(c));
    if (!helperPath) {
      console.log(chalk.red("Record helper not found. Run: swiftc helpers/record.swift -o helpers/record -framework CoreGraphics"));
      process.exit(1);
    }

    console.log(chalk.bold.cyan("computer record") + ` — max ${opts.duration}s`);
    console.log(chalk.dim("Move your mouse, click, type. Press Ctrl+C to stop.\n"));

    const proc = Bun.spawn([helperPath, "--duration", opts.duration], {
      stdout: "pipe",
      stderr: "inherit", // Show progress to terminal
    });

    await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (stdout.trim()) {
      if (opts.output) {
        writeFileSync(opts.output, stdout);
        console.log(chalk.green(`Recording saved to ${opts.output}`));
      } else {
        // Save to default location
        const { getDataDir } = await import("@hasna/cloud");
        const dir = getDataDir("computer");
        const filename = `recording-${Date.now()}.json`;
        const path = join(dir, "recordings", filename);
        const { mkdirSync } = await import("fs");
        mkdirSync(join(dir, "recordings"), { recursive: true });
        writeFileSync(path, stdout);
        console.log(chalk.green(`Recording saved: ${path}`));
      }
    }
  });

// ── completions ──────────────────────────────────────────────────────
program
  .command("completions")
  .description("Generate shell completions")
  .argument("<shell>", "Shell type (zsh or bash)")
  .action(async (shell: string) => {
    if (shell === "zsh") {
      console.log(generateZshCompletions());
    } else if (shell === "bash") {
      console.log(generateBashCompletions());
    } else {
      console.error(chalk.red(`Unknown shell: ${shell}. Use "zsh" or "bash".`));
      process.exit(1);
    }
  });

// ── Cloud commands (sync, feedback) ──────────────────────────────────
registerCloudCommands(program, "computer");

program.parse();

function generateZshCompletions(): string {
  return `#compdef computer
# Zsh completions for @hasna/computer
# Install: computer completions zsh > ~/.zsh/completions/_computer

_computer() {
  local -a commands
  commands=(
    'run:Run a computer use task'
    'screenshot:Take a screenshot'
    'sessions:List sessions'
    'session:Show session details'
    'delete:Delete a session'
    'stats:Show usage statistics'
    'watch:Live-stream agent activity'
    'search:Search sessions'
    'config:View or modify configuration'
    'completions:Generate shell completions'
    'cloud:Cloud sync and feedback'
  )

  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->args'

  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      case "$words[1]" in
        run)
          _arguments \\
            '-p[AI provider]:provider:(anthropic openai)' \\
            '-m[Model to use]:model:' \\
            '-s[Max steps]:steps:' \\
            '--save-screenshots[Save screenshots]' \\
            '--dry-run[Plan without executing]' \\
            '--tag[Tag session]:tag:' \\
            '--max-width[Max screenshot width]:width:' \\
            '--no-preview[Disable inline preview]' \\
            '1:task:'
          ;;
        sessions)
          _arguments \\
            '-n[Limit]:limit:' \\
            '--status[Filter by status]:status:(running completed failed cancelled)' \\
            '--tag[Filter by tag]:tag:'
          ;;
        config)
          local -a config_cmds
          config_cmds=(show get set path edit reset)
          _describe 'config command' config_cmds
          ;;
        completions)
          _arguments '1:shell:(zsh bash)'
          ;;
      esac
      ;;
  esac
}

_computer "$@"`;
}

function generateBashCompletions(): string {
  return `# Bash completions for @hasna/computer
# Install: computer completions bash >> ~/.bashrc

_computer_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="run screenshot sessions session delete stats watch search config completions cloud"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
    run)
      COMPREPLY=( $(compgen -W "-p --provider -m --model -s --max-steps --save-screenshots --dry-run --tag --max-width --no-preview" -- "$cur") )
      ;;
    sessions)
      COMPREPLY=( $(compgen -W "-n --limit --status --tag" -- "$cur") )
      ;;
    config)
      COMPREPLY=( $(compgen -W "show get set path edit reset" -- "$cur") )
      ;;
    completions)
      COMPREPLY=( $(compgen -W "zsh bash" -- "$cur") )
      ;;
    --provider|-p)
      COMPREPLY=( $(compgen -W "anthropic openai" -- "$cur") )
      ;;
    --status)
      COMPREPLY=( $(compgen -W "running completed failed cancelled" -- "$cur") )
      ;;
  esac
}

complete -F _computer_completions computer`;
}
