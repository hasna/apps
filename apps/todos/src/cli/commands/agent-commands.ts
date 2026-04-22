import type { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { releaseAgent, listAgents } from "../../db/agents.js";
import { createTaskList, listTaskLists, deleteTaskList } from "../../db/task-lists.js";
import { listTasks } from "../../db/tasks.js";
import { getPackageVersion, handleError, autoProject, output } from "../helpers.js";

export function registerAgentCommands(program: Command) {
  // init
  program
    .command("init <name>")
    .description("Register an agents and get a short UUID")
    .option("-d, --description <text>", "Agent description")
    .action(async (name: string, opts) => {
      const globalOpts = program.opts();
      try {
        const { registerAgent, isAgentConflict } = await import("../../db/agents.js");
        const result = registerAgent({ name, description: opts.description });
        if (isAgentConflict(result)) {
          console.error(chalk.red("CONFLICT:"), result.message);
          process.exit(1);
        }
        if (globalOpts.json) {
          output(result, true);
        } else {
          console.log(chalk.green("Agent registered:"));
          console.log(`  ${chalk.dim("ID:")}   ${result.id}`);
          console.log(`  ${chalk.dim("Name:")} ${result.name}`);
          console.log(`\nUse ${chalk.cyan(`--agent ${result.id}`)} on future commands.`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  // heartbeat
  program
    .command("heartbeat [agent]")
    .description("Update last_seen_at to signal you're still active")
    .action(async (agent?: string) => {
      const globalOpts = program.opts();
      const agentId = agent || globalOpts.agent;
      if (!agentId) { console.error(chalk.red("Agent ID required. Use --agent or pass as argument.")); process.exit(1); }
      const { updateAgentActivity, getAgent, getAgentByName } = await import("../../db/agents.js");
      const a = getAgent(agentId) || getAgentByName(agentId);
      if (!a) { console.error(chalk.red(`Agent not found: ${agentId}`)); process.exit(1); }
      updateAgentActivity(a.id);
      if (globalOpts.json) { console.log(JSON.stringify({ agent_id: a.id, name: a.name, last_seen_at: new Date().toISOString() })); }
      else { console.log(chalk.green(`♥ ${a.name} (${a.id.slice(0, 8)}) — heartbeat sent`)); }
    });

  // release
  program
    .command("release [agent]")
    .description("Release/logout an agent — clears session binding so the name is immediately available")
    .option("--session-id <id>", "Only release if session ID matches")
    .action(async (agent?: string, opts?: { sessionId?: string }) => {
      const globalOpts = program.opts();
      const agentId = agent || globalOpts.agent;
      if (!agentId) { console.error(chalk.red("Agent ID or name required. Use --agent or pass as argument.")); process.exit(1); }
      const { getAgent, getAgentByName } = await import("../../db/agents.js");
      const a = getAgent(agentId) || getAgentByName(agentId);
      if (!a) { console.error(chalk.red(`Agent not found: ${agentId}`)); process.exit(1); }
      const released = releaseAgent(a.id, opts?.sessionId);
      if (!released) {
        console.error(chalk.red("Release denied: session_id does not match agent's current session."));
        process.exit(1);
      }
      if (globalOpts.json) {
        console.log(JSON.stringify({ agent_id: a.id, name: a.name, released: true }));
      } else {
        console.log(chalk.green(`✓ ${a.name} (${a.id}) released — name is now available.`));
      }
    });

  // focus
  program
    .command("focus [project]")
    .description("Focus on a project (or clear focus if no project given)")
    .action(async (project?: string) => {
      const globalOpts = program.opts();
      const agentId = globalOpts.agent;
      if (!agentId) { console.error(chalk.red("Agent ID required. Use --agent.")); process.exit(1); }
      const db = getDatabase();
      if (project) {
        const { getProjectByPath } = await import("../../db/projects.js");
        const p = getProjectByPath(project, db)
          || (() => { const id = resolvePartialId(db, "projects", project); return id ? db.query("SELECT * FROM projects WHERE id = ?").get(id) : null; })()
          || (db.query("SELECT * FROM projects WHERE name = ? OR task_list_id = ?").get(project, project) as any);
        const projectId = p?.id || project;
        db.run("UPDATE agents SET active_project_id = ? WHERE id = ? OR name = ?", [projectId, agentId, agentId]);
        console.log(chalk.green(`Focused on: ${p?.name || projectId}`));
      } else {
        db.run("UPDATE agents SET active_project_id = NULL WHERE id = ? OR name = ?", [agentId, agentId]);
        console.log(chalk.dim("Focus cleared."));
      }
    });

  // agents
  program
    .command("agents")
    .description("List registered agents")
    .action(async () => {
      const globalOpts = program.opts();
      try {
        const agents = listAgents();
        if (globalOpts.json) {
          output(agents, true);
          return;
        }
        if (agents.length === 0) {
          console.log(chalk.dim("No agents registered. Use 'todos init <name>' to register."));
          return;
        }
        for (const a of agents) {
          console.log(`  ${chalk.cyan(a.id)} ${chalk.bold(a.name)} ${chalk.dim(a.last_seen_at)}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  // agent-update <name>
  program
    .command("agent-update <name>")
    .alias("agents-update")
    .description("Update an agent's description, role, or other fields")
    .option("--description <text>", "New description")
    .option("--role <role>", "New role")
    .option("--title <title>", "New title")
    .action(async (name: string, opts) => {
      const globalOpts = program.opts();
      try {
        const { getAgentByName: findByName, updateAgent: doUpdate } = await import("../../db/agents.js");
        const agent = findByName(name);
        if (!agent) {
          console.error(chalk.red(`Agent not found: ${name}`));
          process.exit(1);
        }
        const updates: Record<string, unknown> = {};
        if (opts.description !== undefined) updates.description = opts.description;
        if (opts.role !== undefined) updates.role = opts.role;
        if (opts.title !== undefined) updates.title = opts.title;
        const updated = doUpdate(agent.id, updates);
        if (globalOpts.json) {
          output(updated, true);
        } else {
          console.log(chalk.green(`Updated agent: ${updated.name} (${updated.id.slice(0, 8)})`));
          if (updated.description) console.log(chalk.dim(`  Description: ${updated.description}`));
          if (updated.role) console.log(chalk.dim(`  Role: ${updated.role}`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // agent <name> — rich single-agent view
  program
    .command("agent <name>")
    .description("Show all info about an agent: tasks, status, last seen, stats")
    .option("-j, --json", "Output as JSON")
    .action(async (name: string, opts) => {
      const globalOpts = program.opts();
      const { getAgentByName: findByName } = await import("../../db/agents.js");
      const agent = findByName(name);

      if (!agent) {
        console.error(chalk.red(`Agent not found: ${name}`));
        process.exit(1);
      }

      const byAssigned = listTasks({ assigned_to: agent.name });
      const byId = listTasks({ agent_id: agent.id });
      const seen = new Set<string>();
      const allTasks = [...byAssigned, ...byId].filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id); return true;
      });

      const pending = allTasks.filter(t => t.status === "pending");
      const inProgress = allTasks.filter(t => t.status === "in_progress");
      const completed = allTasks.filter(t => t.status === "completed");
      const failed = allTasks.filter(t => t.status === "failed");
      const rate = allTasks.length > 0 ? Math.round((completed.length / allTasks.length) * 100) : 0;

      const lastSeenMs = Date.now() - new Date(agent.last_seen_at).getTime();
      const lastSeenMins = Math.floor(lastSeenMs / 60000);
      const lastSeenStr = lastSeenMins < 2 ? chalk.green("just now")
        : lastSeenMins < 60 ? chalk.yellow(`${lastSeenMins}m ago`)
        : lastSeenMins < 1440 ? chalk.yellow(`${Math.floor(lastSeenMins / 60)}h ago`)
        : chalk.dim(`${Math.floor(lastSeenMins / 1440)}d ago`);

      const isOnline = lastSeenMins < 5;

      if (opts.json || globalOpts.json) {
        console.log(JSON.stringify({ agent, tasks: { pending: pending.length, in_progress: inProgress.length, completed: completed.length, failed: failed.length, total: allTasks.length, completion_rate: rate }, all_tasks: allTasks }, null, 2));
        return;
      }

      console.log(`\n${isOnline ? chalk.green("●") : chalk.dim("○")} ${chalk.bold(agent.name)} ${chalk.dim(`(${agent.id})`)}  ${lastSeenStr}`);
      if (agent.description) console.log(chalk.dim(`  ${agent.description}`));
      if (agent.role) console.log(chalk.dim(`  Role: ${agent.role}`));
      console.log();

      console.log(`  ${chalk.yellow(String(pending.length))} pending  ${chalk.blue(String(inProgress.length))} active  ${chalk.green(String(completed.length))} done  ${chalk.dim(`${rate}% rate`)}`);
      console.log();

      if (inProgress.length > 0) {
        console.log(chalk.bold("  In progress:"));
        for (const t of inProgress) {
          const id = t.short_id || t.id.slice(0, 8);
          const staleFlag = new Date(t.updated_at).getTime() < Date.now() - 30 * 60 * 1000 ? chalk.red(" [stale]") : "";
          console.log(`    ${chalk.cyan(id)} ${chalk.yellow(t.priority)} ${t.title}${staleFlag}`);
        }
        console.log();
      }

      if (pending.length > 0) {
        console.log(chalk.bold(`  Pending (${pending.length}):`));
        for (const t of pending.slice(0, 5)) {
          const id = t.short_id || t.id.slice(0, 8);
          const due = t.due_at ? chalk.dim(` due:${t.due_at.slice(0, 10)}`) : "";
          console.log(`    ${chalk.dim(id)} ${t.priority.padEnd(8)} ${t.title}${due}`);
        }
        if (pending.length > 5) console.log(chalk.dim(`    ... and ${pending.length - 5} more`));
        console.log();
      }

      const recentDone = completed.filter(t => t.completed_at).sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime()).slice(0, 3);
      if (recentDone.length > 0) {
        console.log(chalk.bold("  Recently completed:"));
        for (const t of recentDone) {
          const id = t.short_id || t.id.slice(0, 8);
          const when = t.completed_at ? chalk.dim(new Date(t.completed_at).toLocaleDateString()) : "";
          console.log(`    ${chalk.green("✓")} ${chalk.dim(id)} ${t.title} ${when}`);
        }
        console.log();
      }

      if (allTasks.length === 0) {
        console.log(chalk.dim("  No tasks assigned to this agent."));
      }
    });

  // org
  program
    .command("org")
    .description("Show agent org chart — who reports to who")
    .option("--set <agent=manager>", "Set reporting: 'seneca=julius' or 'seneca=' to clear")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const { getOrgChart, getAgentByName: getByName, updateAgent: update } = await import("../../db/agents.js");

      if (opts.set) {
        const [agentName, managerName] = opts.set.split("=");
        const agent = getByName(agentName);
        if (!agent) { console.error(chalk.red(`Agent not found: ${agentName}`)); process.exit(1); }
        let managerId: string | null = null;
        if (managerName) {
          const manager = getByName(managerName);
          if (!manager) { console.error(chalk.red(`Manager not found: ${managerName}`)); process.exit(1); }
          managerId = manager.id;
        }
        update(agent.id, { reports_to: managerId });
        if (globalOpts.json) { output({ agent: agentName, reports_to: managerName || null }, true); }
        else { console.log(chalk.green(managerId ? `${agentName} → ${managerName}` : `${agentName} → (top-level)`)); }
        return;
      }

      const tree = getOrgChart();
      if (globalOpts.json) { output(tree, true); return; }
      if (tree.length === 0) { console.log(chalk.dim("No agents registered.")); return; }

      function render(nodes: any[], indent = 0): void {
        for (const n of nodes) {
          const prefix = "  ".repeat(indent);
          const title = n.agent.title ? chalk.cyan(` — ${n.agent.title}`) : "";
          const level = n.agent.level ? chalk.dim(` (${n.agent.level})`) : "";
          console.log(`${prefix}${indent > 0 ? "├── " : ""}${chalk.bold(n.agent.name)}${title}${level}`);
          render(n.reports, indent + 1);
        }
      }
      render(tree);
    });

  // lists
  program
    .command("lists")
    .aliases(["task-lists", "tl"])
    .description("List and manage task lists")
    .option("--add <name>", "Create a task list")
    .option("--slug <slug>", "Custom slug (with --add)")
    .option("-d, --description <text>", "Description (with --add)")
    .option("--delete <id>", "Delete a task list")
    .action(async (opts) => {
      try {
        const globalOpts = program.opts();
        const projectId = autoProject(globalOpts);

        if (opts.add) {
          const list = createTaskList({ name: opts.add, slug: opts.slug, description: opts.description, project_id: projectId });
          if (globalOpts.json) {
            output(list, true);
            return;
          }
          console.log(chalk.green("Task list created:"));
          console.log(`  ${chalk.dim("ID:")}   ${list.id.slice(0, 8)}`);
          console.log(`  ${chalk.dim("Slug:")} ${list.slug}`);
          console.log(`  ${chalk.dim("Name:")} ${list.name}`);
          return;
        }

        if (opts.delete) {
          const db = getDatabase();
          const resolved = resolvePartialId(db, "task_lists", opts.delete);
          if (!resolved) {
            console.error(chalk.red("Task list not found"));
            process.exit(1);
          }
          deleteTaskList(resolved);
          console.log(chalk.green("Task list deleted."));
          return;
        }

        const lists = listTaskLists(projectId);
        if (globalOpts.json) {
          output(lists, true);
          return;
        }
        if (lists.length === 0) {
          console.log(chalk.dim("No task lists. Use 'todos lists --add <name>' to create one."));
          return;
        }
        for (const l of lists) {
          console.log(`  ${chalk.dim(l.id.slice(0, 8))} ${chalk.bold(l.name)} ${chalk.dim(`(${l.slug})`)}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  // upgrade (self-update)
  program
    .command("upgrade")
    .alias("self-update")
    .description("Update todos to the latest version")
    .option("--check", "Only check for updates, don't install")
    .action(async (opts) => {
      try {
        const currentVersion = getPackageVersion();

        const res = await fetch("https://registry.npmjs.org/@hasna/todos/latest");
        if (!res.ok) {
          console.error(chalk.red("Failed to check for updates."));
          process.exit(1);
        }
        const data = (await res.json()) as { version: string };
        const latestVersion = data.version;

        console.log(`  Current: ${chalk.dim(currentVersion)}`);
        console.log(`  Latest:  ${chalk.green(latestVersion)}`);

        if (currentVersion === latestVersion) {
          console.log(chalk.green("\nAlready up to date!"));
          return;
        }

        if (opts.check) {
          console.log(
            chalk.yellow(`\nUpdate available: ${currentVersion} → ${latestVersion}`),
          );
          return;
        }

        let useBun = false;
        try {
          execSync("which bun", { stdio: "ignore" });
          useBun = true;
        } catch {
          // bun not available, fall back to npm
        }

        const cmd = useBun
          ? "bun add -g @hasna/todos@latest"
          : "npm install -g @hasna/todos@latest";

        console.log(chalk.dim(`\nRunning: ${cmd}`));
        execSync(cmd, { stdio: "inherit" });
        console.log(chalk.green(`\nUpdated to ${latestVersion}!`));
      } catch (e) {
        handleError(e);
      }
    });
}
