#!/usr/bin/env bun
import { Command } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import { createHash } from "node:crypto";
import { platform } from "node:os";
import chalk from "chalk";
import { resumeTask, runTask } from "../agent/loop.js";
import { planGoalDryRun } from "../agent/goal-planner.js";
import { guardTerminalCommandPolicy, formatPolicyRejection } from "../agent/policy.js";
import { listSessions, getSession, getActionLogs, deleteSession, getStats, searchSessions, getDataDir, logAuditEvent, resolveSessionId } from "../db/index.js";
import { captureScreenshot, saveScreenshotToFile } from "../drivers/mac/screenshot.js";
import { inspectMacHelpers, resolveMacHelper } from "../drivers/mac/helpers.js";
import { loadConfig, getConfigValue, setConfigValue, getConfigPath } from "../lib/config.js";
import { calculateCost, formatCost, stepCost } from "../lib/pricing.js";
import { registerStorageCommands } from "./storage.js";
import { renderInlineImage, supportsInlineImages } from "../lib/terminal-image.js";
import { getAppDriver, listAppDrivers } from "../apps/registry.js";
import { parseGrid, parseTabsSpec } from "../apps/ghostty/applescript.js";
import { SESSION_STATUSES, type Provider, type SessionStatus } from "../types/index.js";
import type { AppOpenSpec } from "../apps/types.js";
import { VERSION } from "../version.js";
import { cancelSession, getEmergencyStopSignal, pauseSession } from "../agent/control.js";
import {
  DEFAULT_DETAIL_LOG_LIMIT,
  DEFAULT_ROW_LIMIT,
  pageSlice,
  parseCursor,
  parseLimit,
  renderSearchResults,
  renderSessionDetail,
  renderSessionList,
  renderStatsSummary,
  truncateText,
} from "./output.js";

const program = new Command();
const SESSION_STATUS_COMPLETIONS = SESSION_STATUSES.join(" ");

program
  .name("computer")
  .description("Open-source computer use for AI agents — control your Mac with AI")
  .version(VERSION);

// ── run ──────────────────────────────────────────────────────────────
program
  .command("run")
  .description("Run a computer use task")
  .argument("<task>", "Natural language description of the task")
  .option("-p, --provider <provider>", "AI provider (anthropic|openai)", "anthropic")
  .option("-m, --model <model>", "Model to use")
  .option("--fallback-provider <provider>", "Fallback AI provider (anthropic|openai|none)")
  .option("--fallback-model <model>", "Model to use for fallback provider")
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
      fallbackProvider: opts.fallbackProvider === "none" ? false : opts.fallbackProvider as Provider | undefined,
      fallbackModel: opts.fallbackModel,
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

// ── plan ─────────────────────────────────────────────────────────────
program
  .command("plan")
  .description("Persist a dry-run AI SDK workflow plan without executing OS input")
  .argument("<prompt>", "Natural language goal to plan")
  .option("-s, --max-steps <n>", "Maximum planned steps", "8")
  .option("--workspace-root <path>", "Workspace root to use for terminal-capable planning")
  .option("--json", "Print structured JSON output", false)
  .action(async (prompt: string, opts: { maxSteps?: string; workspaceRoot?: string; json?: boolean }) => {
    const maxSteps = Number.parseInt(opts.maxSteps ?? "8", 10) || 8;
    const plan = await planGoalDryRun({
      prompt,
      maxSteps,
      workspaceRoots: [opts.workspaceRoot ?? process.cwd()],
      actor: "cli",
      transport: "cli",
      metadata: { command: "plan" },
    });

    if (opts.json) {
      console.log(JSON.stringify({
        goal_id: plan.goal.id,
        workflow_id: plan.workflow.id,
        run_id: plan.run.id,
        title: plan.draft.title,
        summary: plan.draft.summary,
        step_count: plan.steps.length,
        steps: plan.steps.map((step) => ({
          index: step.index,
          title: step.step.title,
          tool: step.step.toolName,
          capability: step.route.capability,
          status: step.route.status,
          approval_id: step.approvalId ?? null,
          stop_condition: step.step.stopCondition,
        })),
      }, null, 2));
      return;
    }

    console.log(chalk.bold.cyan("computer plan") + chalk.yellow.bold(" [DRY RUN]"));
    console.log(chalk.dim(`Goal: ${plan.goal.id} | Workflow: ${plan.workflow.id} | Run: ${plan.run.id}`));
    console.log(chalk.bold(plan.draft.title));
    console.log(chalk.dim(plan.draft.summary));
    console.log();
    for (const step of plan.steps) {
      const color = step.route.status === "allowed"
        ? chalk.green
        : step.route.status === "requires_confirmation"
          ? chalk.yellow
          : chalk.red;
      console.log(
        `${chalk.dim(String(step.index + 1).padStart(2, "0"))} ` +
        `${chalk.cyan(step.step.toolName.padEnd(11))} ` +
        `${color(step.route.status.padEnd(21))} ${step.step.title}`
      );
      console.log(chalk.dim(`   ${step.step.stopCondition}`));
    }
  });

// ── screenshot ───────────────────────────────────────────────────────
program
  .command("screenshot")
  .description("Take a screenshot of the current screen")
  .option("-o, --output <path>", "Save to file path")
  .action(async (opts: any) => {
    if (platform() !== "darwin") {
      console.error(chalk.red("Screenshot capture is unavailable on this platform."));
      console.error(chalk.dim("Reason: native screenshot capture currently requires macOS screencapture."));
      process.exit(1);
    }
    try {
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
    } catch (error) {
      console.error(chalk.red("Screenshot capture failed."));
      console.error(chalk.dim(`Reason: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// ── open (app drivers) ───────────────────────────────────────────────
const collectRun = (value: string, previous: string[]) => [...previous, value];

program
  .command("open")
  .description("Open an app deterministically via its driver (no AI; see `computer apps`)")
  .argument("<app>", "App to open (registered driver name, e.g. ghostty)")
  .option("--grid <RxC>", 'Split the window into R rows x C cols (e.g. "2x2")')
  .option("--tabs <specs>", 'Multiple tabs in one window, one grid spec each (e.g. "2x2,1x2,1x2")')
  .option("--run <command>", "Command for the next pane in order (repeatable)", collectRun, [])
  .option("--all", "Run the single --run command in every pane", false)
  .option("--dir <path>", "Working directory — every pane cds here first")
  .option("--approve-terminal-command", "Confirm terminal command execution for --run/--dir", false)
  .option("--max", "Maximize the new window (not native fullscreen)", false)
  .action(async (app: string, opts: any) => {
    const driver = getAppDriver(app);
    if (!driver) {
      console.error(chalk.red(`No app driver registered for "${app}".`));
      console.error(chalk.dim("List available drivers with `computer apps`."));
      process.exit(1);
    }

    const availability = driver.available();
    if (!availability.available) {
      console.error(chalk.red(`${driver.name} is not available on this machine.`));
      if (availability.reason) console.error(chalk.dim(`Reason: ${availability.reason}`));
      process.exit(1);
    }

    let spec: AppOpenSpec;
    try {
      spec = {
        grid: opts.grid ? parseGrid(opts.grid) : undefined,
        tabs: opts.tabs ? parseTabsSpec(opts.tabs) : undefined,
        run: opts.run,
        all: opts.all,
        dir: opts.dir,
        max: opts.max,
        terminalApproval: {
          approved: opts.approveTerminalCommand,
          audit: false,
          transport: "cli",
          metadata: { app, command_count: opts.run?.length ?? 0 },
          signal: getEmergencyStopSignal(),
        },
      };
      const terminalDecision = await guardTerminalCommandPolicy(
        { app, run: spec.run, dir: spec.dir },
        {
          approved: opts.approveTerminalCommand,
          transport: "cli",
          capability: "computer.terminal",
          metadata: { app, command_count: spec.run?.length ?? 0 },
        },
      );
      if (!terminalDecision.allowed) {
        console.error(chalk.red(formatPolicyRejection(terminalDecision)));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }

    const result = await driver.open(spec!);
    if (result.transcript) {
      await logAuditEvent({
        event: "terminal.transcript_created",
        transport: "cli",
        capability: "computer.terminal",
        action_type: "terminal_command",
        action_data: {
          app,
          transcript_id: result.transcript.id,
          command_count: result.transcript.commandCount,
          redacted: true,
        },
        decision: "created",
        metadata: {
          manifest_path: result.transcript.manifestPath,
          pane_count: result.transcript.panes.length,
        },
      });
    }
    if (result.ok) {
      console.log(chalk.green(result.message));
      if (result.transcript) {
        console.log(chalk.dim(`Transcript manifest: ${result.transcript.manifestPath}`));
      }
    } else {
      console.error(chalk.red(result.message));
      process.exit(1);
    }
  });

// ── apps ─────────────────────────────────────────────────────────────
program
  .command("apps")
  .description("List registered app drivers and their availability on this machine")
  .action(async () => {
    const drivers = listAppDrivers();
    if (drivers.length === 0) {
      console.log(chalk.dim("No app drivers registered."));
      return;
    }
    console.log(chalk.bold("App drivers\n"));
    for (const driver of drivers) {
      const availability = driver.available();
      const status = availability.available ? chalk.green("available") : chalk.red("unavailable");
      console.log(`  ${chalk.cyan(driver.name.padEnd(12))} ${status}  ${chalk.dim(driver.description)}`);
      if (!availability.available && availability.reason) {
        console.log(chalk.dim(`  ${" ".repeat(12)} ${availability.reason}`));
      }
    }
  });

// ── sessions ─────────────────────────────────────────────────────────
program
  .command("sessions")
  .description("List computer use sessions")
  .option("-n, --limit <n>", "Number of sessions to show", String(DEFAULT_ROW_LIMIT))
  .option("--cursor <n>", "Zero-based result offset for pagination", "0")
  .option("--status <status>", "Filter by status")
  .option("--tag <tag>", "Filter by tag")
  .option("--json", "Print full session records as JSON", false)
  .action(async (opts: any) => {
    const limit = parseLimit(opts.limit);
    const cursor = parseCursor(opts.cursor);
    const result = listSessions({
      limit: limit + 1,
      offset: cursor,
      status: opts.status,
      tag: opts.tag,
    });
    const { page: sessions, hasMore, nextCursor } = pageSlice(result, limit, cursor);

    if (opts.json) {
      console.log(JSON.stringify({
        sessions,
        limit,
        cursor,
        has_more: hasMore,
        next_cursor: hasMore ? nextCursor : null,
      }, null, 2));
      return;
    }

    console.log(renderSessionList(sessions, {
      limit,
      cursor,
      hasMore,
      nextCursor,
      detailHint: "Details: use `computer session <id> --verbose`; full data: `computer session <id> --json`.",
    }));
  });

// ── session ──────────────────────────────────────────────────────────
program
  .command("session")
  .description("Show details of a session")
  .argument("<id>", "Session ID (or prefix)")
  .option("-n, --limit <n>", "Number of action-log rows to show by default", String(DEFAULT_DETAIL_LOG_LIMIT))
  .option("--cursor <n>", "Zero-based action-log offset for pagination", "0")
  .option("--verbose", "Show the complete action log in human-readable form", false)
  .option("--json", "Print full session and action log records as JSON", false)
  .action(async (id: string, opts: any) => {
    const session = resolveSessionId(id);

    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }

    const logs = getActionLogs(session.id);
    if (opts.json) {
      console.log(JSON.stringify({ session, action_logs: logs }, null, 2));
      return;
    }

    const limit = parseLimit(opts.limit, DEFAULT_DETAIL_LOG_LIMIT);
    const cursor = parseCursor(opts.cursor);
    console.log(renderSessionDetail(session, logs, {
      verbose: opts.verbose,
      limit,
      cursor,
      hasMore: !opts.verbose && logs.length > cursor + limit,
      nextCursor: cursor + Math.min(limit, Math.max(0, logs.length - cursor)),
    }));
  });

// ── delete ───────────────────────────────────────────────────────────
program
  .command("delete")
  .description("Delete a session")
  .argument("<id>", "Session ID (or prefix)")
  .action(async (id: string) => {
    const session = resolveSessionId(id);
    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }
    deleteSession(session.id);
    console.log(chalk.green(`Deleted session: ${session.id}`));
  });

// ── pause ────────────────────────────────────────────────────────────
program
  .command("pause")
  .description("Pause a running session before its next action")
  .argument("<id>", "Session ID (or prefix)")
  .option("--reason <text>", "Reason for pausing")
  .action(async (id: string, opts: { reason?: string }) => {
    const session = resolveSessionArg(id);
    const state = pauseSession(session.id, opts.reason);
    await logAuditEvent({
      event: "run_control.pause_session",
      transport: "cli",
      capability: "computer.pause_session",
      decision: "requested",
      reason: opts.reason,
      metadata: { session_id: session.id },
    });
    console.log(chalk.yellow(`Paused session ${state.session_id}`));
  });

// ── resume ───────────────────────────────────────────────────────────
program
  .command("resume")
  .description("Resume a paused session from persisted state")
  .argument("<id>", "Session ID (or prefix)")
  .option("-p, --provider <provider>", "AI provider (anthropic|openai)")
  .option("-m, --model <model>", "Model to use")
  .option("-s, --max-steps <n>", "Maximum total steps before stopping", "50")
  .option("--dry-run", "Plan actions without executing them", false)
  .option("--save-screenshots", "Save screenshots to disk", false)
  .option("--screenshots-dir <dir>", "Directory to save screenshots")
  .option("--max-width <px>", "Max screenshot width for AI model (default: 1280)", "1280")
  .option("--display <n>", "Display number to capture (1=main, 2=secondary)")
  .action(async (id: string, opts: any) => {
    const session = resolveSessionArg(id);
    const cfg = loadConfig();
    console.log(chalk.bold.cyan("computer") + chalk.yellow.bold(" [RESUME]") + ` — ${session.id}`);
    const resumed = await resumeTask(session.id, {
      provider: opts.provider as Provider | undefined,
      model: opts.model,
      maxSteps: parseInt(opts.maxSteps) || cfg.maxSteps,
      saveScreenshots: opts.saveScreenshots ?? cfg.saveScreenshots,
      screenshotsDir: opts.screenshotsDir ?? cfg.screenshotsDir,
      screenshotMaxWidth: parseInt(opts.maxWidth) || cfg.screenshotMaxWidth,
      dryRun: opts.dryRun,
      displayNumber: opts.display ? parseInt(opts.display) : undefined,
      onStep: (step, response, result) => {
        const status = result.success ? chalk.green("OK") : chalk.red("FAIL");
        console.log(chalk.dim(`[${String(step + 1).padStart(3)}]`) + ` ${status} ${chalk.yellow(response.action?.type ?? "done")}`);
      },
    });
    await logAuditEvent({
      event: "run_control.resume_session",
      transport: "cli",
      capability: "computer.resume_session",
      decision: resumed.status,
      metadata: { session_id: session.id },
    });
    console.log(chalk.dim(`Status: ${resumed.status} | Steps: ${resumed.steps} | Session: ${resumed.id}`));
  });

// ── cancel ───────────────────────────────────────────────────────────
program
  .command("cancel")
  .description("Cancel a running or paused session")
  .argument("<id>", "Session ID (or prefix)")
  .option("--reason <text>", "Reason for cancellation")
  .action(async (id: string, opts: { reason?: string }) => {
    const session = resolveSessionArg(id);
    cancelSession(session.id, opts.reason);
    await logAuditEvent({
      event: "run_control.cancel_session",
      transport: "cli",
      capability: "computer.cancel_session",
      decision: "requested",
      reason: opts.reason,
      metadata: { session_id: session.id },
    });
    console.log(chalk.red(`Cancel requested for session ${session.id}`));
  });

// ── stats ────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show usage statistics")
  .option("--json", "Print full stats as JSON", false)
  .action(async (opts: { json?: boolean }) => {
    const stats = getStats();
    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log(renderStatsSummary(stats));
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
  .option("-n, --limit <n>", "Max results", String(DEFAULT_ROW_LIMIT))
  .option("--cursor <n>", "Zero-based result offset for pagination", "0")
  .option("--json", "Print full search result records as JSON", false)
  .action(async (query: string, opts: any) => {
    const limit = parseLimit(opts.limit);
    const cursor = parseCursor(opts.cursor);
    const result = searchSessions(query, limit + 1, cursor);
    const { page: sessions, hasMore, nextCursor } = pageSlice(result, limit, cursor);
    if (opts.json) {
      console.log(JSON.stringify({
        sessions,
        limit,
        cursor,
        has_more: hasMore,
        next_cursor: hasMore ? nextCursor : null,
      }, null, 2));
      return;
    }
    console.log(renderSearchResults({ sessions }, { query, limit, cursor, hasMore, nextCursor }));
  });

// ── config ───────────────────────────────────────────────────────────
const configCmd = program
  .command("config")
  .description("View or modify configuration");

configCmd
  .command("show")
  .description("Show current configuration")
  .option("--json", "Print full configuration as JSON", false)
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig();
    if (opts.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    console.log(`Config: ${getConfigPath()}`);
    console.log(`Provider: ${config.provider}${config.model ? ` / ${config.model}` : ""}`);
    console.log(`Max steps: ${config.maxSteps} | Screenshot max width: ${config.screenshotMaxWidth}px`);
    console.log(`Save screenshots: ${config.saveScreenshots ? "yes" : "no"}${config.screenshotsDir ? ` | Dir: ${truncateText(config.screenshotsDir, 80)}` : ""}`);
    console.log(`Provider fallback: ${config.providerFallback.enabled ? "enabled" : "disabled"}`);
    console.log(`Safety: ${config.safety.blockedApps?.length ?? 0} blocked app(s), ${config.safety.blockedDomains?.length ?? 0} blocked domain(s), confirm clicks ${config.safety.confirmClicks ? "on" : "off"}`);
    console.log("Full configuration: use `computer config show --json`.");
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
  .option("-n, --limit <n>", "Maximum replay steps to print")
  .option("--cursor <n>", "Zero-based replay step offset", "0")
  .option("--preview", "Render saved screenshot previews when supported", false)
  .option("--no-preview", "Keep inline screenshot preview disabled (default)")
  .action(async (id: string, opts: any) => {
    const session = resolveSessionId(id);
    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }

    const allLogs = getActionLogs(session.id);
    const cursor = parseCursor(opts.cursor);
    const limit = opts.limit ? parseLimit(opts.limit, DEFAULT_DETAIL_LOG_LIMIT) : DEFAULT_DETAIL_LOG_LIMIT;
    const logs = allLogs.slice(cursor, cursor + limit);
    if (logs.length === 0) {
      console.log(chalk.dim("No action logs for this session."));
      process.exit(0);
    }

    const speed = parseFloat(opts.speed);
    const totalCost = formatCost(calculateCost(session.model, session.total_tokens_in, session.total_tokens_out));

    console.log(chalk.bold.cyan("computer replay") + ` — ${chalk.dim(session.id.slice(0, 8))}`);
    console.log(chalk.dim(`Task: ${session.task}`));
    console.log(chalk.dim(`Provider: ${session.provider} | ${logs.length}/${allLogs.length} steps | Speed: ${speed}x\n`));

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
      if (opts.preview === true && log.screenshot_path && supportsInlineImages()) {
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
    if (allLogs.length > cursor + logs.length) {
      console.log(chalk.dim(`More steps available: use --cursor ${cursor + logs.length}${opts.limit ? ` --limit ${limit}` : ""}.`));
    }
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

// ── validate-machine ─────────────────────────────────────────────────
program
  .command("validate-machine")
  .description("Run a packaged local machine readiness smoke")
  .option("--json", "Print structured JSON output", false)
  .option("--allow-failures", "Exit 0 even when the local machine is not ready", false)
  .option("--skip-screenshot", "Skip the local screenshot capture attempt", false)
  .action(async (opts: { json?: boolean; allowFailures?: boolean; skipScreenshot?: boolean }) => {
    const { getHeadlessStatus } = await import("../drivers/mac/headless.js");
    const checks: Array<{
      id: string;
      status: "passed" | "failed" | "skipped";
      summary: string;
      data?: Record<string, unknown>;
    }> = [];

    const headless = await getHeadlessStatus();
    checks.push({
      id: "local-headless-status",
      status: "passed",
      summary: headless.recommendation,
      data: {
        display: headless.display,
        screen_sharing: headless.screenSharing,
        lume: headless.lume,
        platform: platform(),
      },
    });

    const apps = listAppDrivers().map((driver) => {
      const availability = driver.available();
      return {
        name: driver.name,
        available: availability.available,
        reason: availability.reason ?? null,
      };
    });
    checks.push({
      id: "app-drivers",
      status: "passed",
      summary: `${apps.length} app driver(s) inspected.`,
      data: { apps },
    });

    const nativeTools = await inspectNativeTools();
    const missingRequiredTools = nativeTools.filter((tool) => tool.required && !tool.available);
    checks.push({
      id: "native-tools",
      status: missingRequiredTools.length === 0 ? "passed" : "failed",
      summary: platform() === "darwin"
        ? missingRequiredTools.length === 0
          ? "Required macOS desktop tools are available."
          : `Missing required macOS desktop tool(s): ${missingRequiredTools.map((tool) => tool.name).join(", ")}.`
        : "macOS desktop tool checks are not required on this platform.",
      data: { tools: nativeTools },
    });

    const helpers = inspectMacHelpers();
    const helperFailures = helpers.filter((helper) => !helper.found || !helper.executable);
    checks.push({
      id: "packaged-helpers",
      status: helperFailures.length === 0 ? "passed" : "failed",
      summary: helperFailures.length === 0
        ? "Packaged helper binaries are present and executable."
        : `Missing or non-executable helper binary/binaries: ${helperFailures.map((helper) => helper.name).join(", ")}.`,
      data: {
        helpers: helpers.map((helper) => ({
          name: helper.name,
          found: helper.found,
          executable: helper.executable,
          location: classifyHelperLocation(helper.path),
          candidate_count: helper.candidates.length,
          reason: helper.reason,
        })),
      },
    });

    if (opts.skipScreenshot) {
      checks.push({
        id: "local-screenshot",
        status: "skipped",
        summary: "Screenshot skipped by --skip-screenshot.",
      });
    } else if (platform() !== "darwin") {
      checks.push({
        id: "local-screenshot",
        status: "skipped",
        summary: "Local native screenshot is macOS-only in this package.",
      });
    } else {
      try {
        const screenshot = await captureScreenshot();
        const bytes = Buffer.from(screenshot.base64, "base64");
        checks.push({
          id: "local-screenshot",
          status: "passed",
          summary: "Local screenshot captured and hashed.",
          data: {
            width: screenshot.size.width,
            height: screenshot.size.height,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        });
      } catch (error) {
        checks.push({
          id: "local-screenshot",
          status: "failed",
          summary: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const blockers = checks
      .filter((check) => {
        if (check.id === "local-screenshot") return check.status !== "passed";
        if (check.id === "native-tools" || check.id === "packaged-helpers") return check.status === "failed";
        return false;
      })
      .map((check) => check.summary);
    const ready = blockers.length === 0;
    const report = {
      schema_version: "open-computer.installed-machine-smoke.v1",
      generated_at: new Date().toISOString(),
      package: {
        name: "@hasna/computer",
        version: VERSION,
      },
      environment: {
        platform: process.platform,
        arch: process.arch,
        bun: Bun.version,
        node: process.version,
      },
      checks,
      readiness: {
        ready,
        blockers,
      },
    };

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(chalk.bold("Machine Validation Smoke\n"));
      for (const check of checks) {
        const color = check.status === "passed" ? chalk.green : check.status === "failed" ? chalk.red : chalk.yellow;
        console.log(`  ${color(check.status.padEnd(7))} ${chalk.cyan(check.id)}  ${check.summary}`);
      }
      console.log();
      console.log(ready ? chalk.green("Ready") : chalk.yellow("Not ready"));
      for (const blocker of blockers) console.log(chalk.dim(`  - ${blocker}`));
    }

    if (!ready && !opts.allowFailures) process.exit(1);
  });

async function inspectNativeTools(): Promise<Array<{ name: string; required: boolean; available: boolean; reason: string | null }>> {
  const requiredOnMac = ["screencapture", "osascript", "open", "cliclick"];
  if (platform() !== "darwin") {
    return requiredOnMac.map((name) => ({
      name,
      required: false,
      available: false,
      reason: "macOS-only desktop control tool",
    }));
  }

  const tools = await Promise.all(requiredOnMac.map(async (name) => ({
    name,
    required: true,
    available: await commandExists(name),
    reason: null,
  })));
  return tools.map((tool) => ({
    ...tool,
    reason: tool.available ? null : "required command is not on PATH",
  }));
}

async function commandExists(name: string): Promise<boolean> {
  const proc = Bun.spawn(["sh", "-lc", `command -v ${name}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return await proc.exited === 0;
}

function classifyHelperLocation(path: string | null): string | null {
  if (!path) return null;
  if (path.includes("/node_modules/")) return "package";
  if (path.includes("/.hasna/computer/helpers/")) return "user";
  if (path.includes("/helpers/")) return "workspace";
  return "unknown";
}

// ── record ───────────────────────────────────────────────────────────
program
  .command("record")
  .description("Record mouse/keyboard events as a replayable macro")
  .option("-d, --duration <seconds>", "Max recording duration in seconds", "60")
  .option("-o, --output <file>", "Save recording to JSON file")
  .action(async (opts: any) => {
    const { join } = await import("path");
    const { writeFileSync } = await import("fs");

    let helperPath: string;
    try {
      helperPath = resolveMacHelper("record");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(message));
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

// ── Storage commands (sync, feedback) ────────────────────────────────
registerStorageCommands(program);
registerEventsCommands(program, { source: "computer" });

program.parse();

function resolveSessionArg(id: string) {
  const session = resolveSessionId(id);
  if (!session) {
    console.log(chalk.red(`Session not found: ${id}`));
    process.exit(1);
  }
  return session;
}

function generateZshCompletions(): string {
  return `#compdef computer
# Zsh completions for @hasna/computer
# Install: computer completions zsh > ~/.zsh/completions/_computer

_computer() {
  local -a commands
  commands=(
    'run:Run a computer use task'
    'open:Open an app via its driver'
    'apps:List app drivers'
    'screenshot:Take a screenshot'
    'sessions:List sessions'
    'session:Show session details'
    'delete:Delete a session'
    'pause:Pause a running session'
    'resume:Resume a paused session'
    'cancel:Cancel a session'
    'stats:Show usage statistics'
    'watch:Live-stream agent activity'
    'search:Search sessions'
    'config:View or modify configuration'
    'completions:Generate shell completions'
    'storage:Storage sync and feedback'
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
            '--fallback-provider[Fallback AI provider]:provider:(anthropic openai none)' \\
            '--fallback-model[Fallback model to use]:model:' \\
            '-s[Max steps]:steps:' \\
            '--save-screenshots[Save screenshots]' \\
            '--dry-run[Plan without executing]' \\
            '--tag[Tag session]:tag:' \\
            '--max-width[Max screenshot width]:width:' \\
            '--no-preview[Disable inline preview]' \\
            '1:task:'
          ;;
        open)
          _arguments \\
            '--grid[Pane grid RxC]:grid:' \\
            '--tabs[Tab grid specs]:tabs:' \\
            '*--run[Command per pane]:command:' \\
            '--all[Same command in every pane]' \\
            '--dir[Working directory]:dir:_files -/' \\
            '--approve-terminal-command[Approve terminal command execution]' \\
            '--max[Maximize window]' \\
            '1:app:(ghostty)'
          ;;
        sessions)
          _arguments \\
            '-n[Limit]:limit:' \\
            '--status[Filter by status]:status:(${SESSION_STATUS_COMPLETIONS})' \\
            '--tag[Filter by tag]:tag:'
          ;;
        pause|cancel)
          _arguments \\
            '--reason[Reason]:reason:' \\
            '1:session id:'
          ;;
        resume)
          _arguments \\
            '-p[AI provider]:provider:(anthropic openai)' \\
            '-m[Model to use]:model:' \\
            '-s[Max total steps]:steps:' \\
            '--save-screenshots[Save screenshots]' \\
            '--dry-run[Plan without executing]' \\
            '--max-width[Max screenshot width]:width:' \\
            '--display[Display number]:display:' \\
            '1:session id:'
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
  commands="run open apps screenshot sessions session delete pause resume cancel stats watch search config completions storage"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
    run)
      COMPREPLY=( $(compgen -W "-p --provider -m --model --fallback-provider --fallback-model -s --max-steps --save-screenshots --dry-run --tag --max-width --no-preview" -- "$cur") )
      ;;
    open)
      COMPREPLY=( $(compgen -W "ghostty --grid --tabs --run --all --dir --approve-terminal-command --max" -- "$cur") )
      ;;
    sessions)
      COMPREPLY=( $(compgen -W "-n --limit --status --tag" -- "$cur") )
      ;;
    pause|cancel)
      COMPREPLY=( $(compgen -W "--reason" -- "$cur") )
      ;;
    resume)
      COMPREPLY=( $(compgen -W "-p --provider -m --model -s --max-steps --save-screenshots --dry-run --max-width --display" -- "$cur") )
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
    --fallback-provider)
      COMPREPLY=( $(compgen -W "anthropic openai none" -- "$cur") )
      ;;
    --status)
      COMPREPLY=( $(compgen -W "${SESSION_STATUS_COMPLETIONS}" -- "$cur") )
      ;;
  esac
}

complete -F _computer_completions computer`;
}

function colorSessionStatus(status: SessionStatus): typeof chalk.green {
  switch (status) {
    case "completed":
      return chalk.green;
    case "failed":
    case "cancelled":
    case "max_steps_exceeded":
      return chalk.red;
    case "running":
    case "waiting_on_approval":
    case "cancelling":
      return chalk.yellow;
    default:
      return chalk.dim;
  }
}
