import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDatabase } from "../../db/database.js";
import { listTasks } from "../../db/tasks.js";
import { loadConfig } from "../../lib/config.js";
import { autoProject, output, formatTaskLine, normalizeStatus } from "../helpers.js";

export function registerConfigServeCommands(program: Command) {
  // config
  program
    .command("config")
    .description("View or update configuration")
    .option("--get <key>", "Get a config value")
    .option("--set <key=value>", "Set a config value (e.g. completion_guard.enabled=true)")
    .action((opts) => {
      const globalOpts = program.opts();
      const home = process.env["HOME"] || "~";
      const newPath = join(home, ".hasna", "todos", "config.json");
      const legacyPath = join(home, ".todos", "config.json");
      const configPath = (!existsSync(newPath) && existsSync(legacyPath)) ? legacyPath : newPath;

      if (opts.get) {
        const config = loadConfig();
        const keys = opts.get.split(".");
        let value: any = config;
        for (const k of keys) { value = value?.[k]; }
        if (globalOpts.json) {
          output({ key: opts.get, value }, true);
        } else {
          console.log(value !== undefined ? JSON.stringify(value, null, 2) : chalk.dim("(not set)"));
        }
        return;
      }

      if (opts.set) {
        const [key, ...valueParts] = opts.set.split("=");
        const rawValue = valueParts.join("=");
        let parsedValue: any;
        try { parsedValue = JSON.parse(rawValue); } catch { parsedValue = rawValue; }

        let config: any = {};
        try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}

        const keys = key.split(".");
        let obj = config;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") obj[keys[i]] = {};
          obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = parsedValue;

        const dir = dirname(configPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        if (globalOpts.json) {
          output({ key, value: parsedValue }, true);
        } else {
          console.log(chalk.green(`Set ${key} = ${JSON.stringify(parsedValue)}`));
        }
        return;
      }

      // No args: show full config
      const config = loadConfig();
      if (globalOpts.json) {
        output(config, true);
      } else {
        console.log(JSON.stringify(config, null, 2));
      }
    });

  // serve (web dashboard)
  program
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Port number", "19427")
    .option("--host <host>", "Host to bind (default: 127.0.0.1 localhost only, use 0.0.0.0 for all interfaces)")
    .option("--no-open", "Don't open browser automatically")
    .action(async (opts) => {
      const { startServer } = await import("../../server/serve.js");
      const requestedPort = parseInt(opts.port, 10);
      let port = requestedPort;
      // Auto-find free port if default is in use
      for (let p = requestedPort; p < requestedPort + 100; p++) {
        try {
          const s = Bun.serve({ port: p, fetch: () => new Response("") });
          s.stop(true);
          port = p;
          break;
        } catch { /* port in use */ }
      }
      if (port !== requestedPort) {
        console.log(`Port ${requestedPort} in use, using ${port}`);
      }
      await startServer(port, { open: opts.open !== false, host: opts.host });
    });

  // watch
  program
    .command("watch")
    .description("Live-updating task list (refreshes every few seconds)")
    .option("-s, --status <status>", "Filter by status (default: pending,in_progress)")
    .option("-i, --interval <seconds>", "Refresh interval in seconds", "5")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      const interval = parseInt(opts.interval, 10) * 1000;
      const statusFilter = opts.status ? opts.status.split(",").map((s: string) => normalizeStatus(s.trim())) : ["pending", "in_progress"];

      function render() {
        const tasks = listTasks({ project_id: projectId, status: statusFilter as any });
        const all = listTasks({ project_id: projectId });
        const counts: Record<string, number> = {};
        for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;

        // Clear screen
        process.stdout.write("\x1B[2J\x1B[0f");

        // Header
        const now = new Date().toLocaleTimeString();
        console.log(chalk.bold(`todos watch`) + chalk.dim(` — ${now} — refreshing every ${opts.interval}s — Ctrl+C to stop\n`));

        // Stats line
        const parts = [
          `total: ${chalk.bold(String(all.length))}`,
          `pending: ${chalk.yellow(String(counts["pending"] || 0))}`,
          `in_progress: ${chalk.blue(String(counts["in_progress"] || 0))}`,
          `completed: ${chalk.green(String(counts["completed"] || 0))}`,
          `failed: ${chalk.red(String(counts["failed"] || 0))}`,
        ];
        console.log(parts.join("  ") + "\n");

        if (tasks.length === 0) {
          console.log(chalk.dim("No matching tasks."));
          return;
        }

        for (const t of tasks) {
          console.log(formatTaskLine(t));
        }
        console.log(chalk.dim(`\n${tasks.length} task(s) shown`));
      }

      render();
      const timer = setInterval(render, interval);

      process.on("SIGINT", () => {
        clearInterval(timer);
        process.exit(0);
      });

      // Keep alive
      await new Promise(() => {});
    });

  // stream — SSE task event stream
  program
    .command("stream")
    .description("Subscribe to real-time task events via SSE (requires todos serve)")
    .option("--agent <id>", "Filter to events for a specific agent")
    .option("--events <list>", "Comma-separated event types (default: all)", "task.created,task.started,task.completed,task.failed,task.assigned,task.status_changed")
    .option("--port <n>", "Server port", "3000")
    .option("--json", "Output raw JSON events")
    .action(async (opts) => {
      const baseUrl = `http://localhost:${opts.port}`;
      const params = new URLSearchParams();
      if (opts.agent) params.set("agent_id", opts.agent);
      if (opts.events) params.set("events", opts.events);
      const url = `${baseUrl}/api/tasks/stream?${params}`;

      const eventColors: Record<string, (s: string) => string> = {
        "task.created": chalk.blue,
        "task.started": chalk.cyan,
        "task.completed": chalk.green,
        "task.failed": chalk.red,
        "task.assigned": chalk.yellow,
        "task.status_changed": chalk.magenta,
      };

      console.log(chalk.dim(`Connecting to ${url} — Ctrl+C to stop\n`));

      try {
        const resp = await fetch(url);
        if (!resp.ok || !resp.body) {
          console.error(chalk.red(`Failed to connect: ${resp.status}`));
          process.exit(1);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          let eventName = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "connected") continue;
                if (opts.json) {
                  console.log(JSON.stringify({ event: eventName, ...data }));
                } else {
                  const colorFn = eventColors[eventName] || chalk.white;
                  const ts = new Date(data.timestamp || Date.now()).toLocaleTimeString();
                  const taskId = data.task_id ? data.task_id.slice(0, 8) : "";
                  const agentInfo = data.agent_id ? ` [${data.agent_id}]` : "";
                  console.log(`${chalk.dim(ts)} ${colorFn(eventName.padEnd(25))} ${taskId}${agentInfo}`);
                }
              } catch {}
              eventName = "";
            }
          }
        }
      } catch (e) {
        console.error(chalk.red(`Connection error: ${e instanceof Error ? e.message : e}`));
        console.error(chalk.dim("Is `todos serve` running?"));
        process.exit(1);
      }
    });

  // interactive (TUI)
  program
    .command("interactive")
    .description("Launch interactive TUI")
    .action(async () => {
      const { renderApp } = await import("../components/App.js");
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      renderApp(projectId);
    });

  // blame
  program
    .command("blame <file>")
    .description("Show which tasks/agents touched a file and why — combines task_files + task_commits")
    .action(async (filePath: string) => {
      const globalOpts = program.opts();
      const { findTasksByFile } = await import("../../db/task-files.js");
      const { getTask } = await import("../../db/tasks.js");
      const db = getDatabase();

      // Find via task_files
      const taskFiles = findTasksByFile(filePath, db) as any[];

      // Find via task_commits (search files_changed JSON)
      const commitRows = db.query(
        "SELECT tc.*, t.title, t.short_id FROM task_commits tc JOIN tasks t ON t.id = tc.task_id WHERE tc.files_changed LIKE ? ORDER BY tc.committed_at DESC"
      ).all(`%${filePath}%`) as any[];

      if (globalOpts.json) {
        output({ file: filePath, task_files: taskFiles, commits: commitRows }, true);
        return;
      }

      console.log(chalk.bold(`\nBlame: ${filePath}\n`));

      if (taskFiles.length > 0) {
        console.log(chalk.bold("Task File Links:"));
        for (const tf of taskFiles) {
          const task = getTask(tf.task_id, db);
          const title = task ? task.title : "unknown";
          const sid = task?.short_id || tf.task_id.slice(0, 8);
          console.log(`  ${chalk.cyan(sid)} ${title} — ${chalk.dim(tf.role || "file")} ${chalk.dim(tf.updated_at)}`);
        }
      }

      if (commitRows.length > 0) {
        console.log(chalk.bold(`\nCommit Links (${commitRows.length}):`));
        for (const c of commitRows) {
          const sid = c.short_id || c.task_id.slice(0, 8);
          console.log(`  ${chalk.yellow(c.sha?.slice(0, 7) || "?")} ${chalk.cyan(sid)} ${c.title || ""} — ${chalk.dim(c.author || "")} ${chalk.dim(c.committed_at || "")}`);
        }
      }

      if (taskFiles.length === 0 && commitRows.length === 0) {
        console.log(chalk.dim("No task or commit links found for this file."));
        console.log(chalk.dim("Use 'todos hook install' to auto-link future commits."));
      }
      console.log();
    });

  // dashboard
  program
    .command("dashboard")
    .description("Live-updating dashboard showing project health, agents, task flow")
    .option("--project <id>", "Filter to project")
    .option("--refresh <ms>", "Refresh interval in ms (default: 2000)", "2000")
    .action(async (opts) => {
      const { render } = await import("ink");
      const React = await import("react");
      const { Dashboard } = await import("../components/Dashboard.js");
      const globalOpts = program.opts();
      const projectId = opts.project || autoProject(globalOpts) || undefined;
      render(React.createElement(Dashboard, { projectId, refreshMs: parseInt(opts.refresh, 10) }));
    });
}
