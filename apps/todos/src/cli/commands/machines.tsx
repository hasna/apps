import type { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, now, uuid } from "../../db/database.js";
import {
  registerMachine,
  listMachines,
  getMachineByName,
  setPrimaryMachine,
  getPrimaryMachine,
  archiveMachine,
  unarchiveMachine,
  deleteMachine as deleteMachineDb,
} from "../../db/machines.js";

function getOrCreateLocalMachineName(): string {
  return process.env["TODOS_MACHINE_NAME"] || require("node:os").hostname() || "unknown";
}

function findRemoteDbPath(sshAddress: string): string | null {
  try {
    const result = execSync(
      `ssh ${sshAddress} 'find ~ -name "todos.db" -path "*/.todos/*" 2>/dev/null | head -1'`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

function remoteJsonDump(sshAddress: string, dbPath: string): string {
  return execSync(
    `ssh ${sshAddress} 'sqlite3 "${dbPath}" ".mode json SELECT * FROM tasks;" 2>/dev/null'`,
    { encoding: "utf-8", timeout: 30000 },
  );
}

function upsertTasks(remoteJson: string, sourceMachineId: string, localMachineId: string): number {
  if (!remoteJson.trim()) return 0;
  const remoteTasks = JSON.parse(remoteJson);
  const db = getDatabase();
  let upserted = 0;

  for (const rt of remoteTasks) {
    if (rt.machine_id === localMachineId) continue;
    const existing = db.query("SELECT id FROM tasks WHERE id = ?").get(rt.id) as { id: string } | undefined;
    if (existing) {
      db.run(
        `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, updated_at = ? WHERE id = ?`,
        [rt.title, rt.description, rt.status, rt.priority, rt.updated_at || now(), rt.id],
      );
    } else {
      try {
        db.run(
          `INSERT INTO tasks (id, title, description, status, priority, machine_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [rt.id, rt.title, rt.description || "", rt.status, rt.priority, sourceMachineId, rt.created_at || now(), rt.updated_at || now()],
        );
      } catch {
        // Skip duplicates or FK constraint failures
      }
    }
    upserted++;
  }
  return upserted;
}

export function registerMachineCommands(program: Command) {
  const machinesCmd = program
    .command("machines")
    .description("List registered machines")
    .option("-a, --all", "Include archived machines")
    .action((opts) => {
      const db = getDatabase();
      const machines = listMachines(db, opts.all);

      if (machines.length === 0) {
        console.log(chalk.yellow("No machines registered."));
        console.log(chalk.dim("Use `todos machines register` to add one."));
        return;
      }

      for (const m of machines) {
        const primaryTag = m.is_primary ? chalk.bold(" [PRIMARY]") : "";
        const archivedTag = m.archived_at ? chalk.dim(" [ARCHIVED]") : "";
        console.log(
          `${chalk.cyan(m.name)} (${m.id.slice(0, 8)})${primaryTag}${archivedTag}`,
        );
        console.log(chalk.dim(`  Host: ${m.hostname ?? "unknown"} | Platform: ${m.platform ?? "unknown"}`));
        console.log(chalk.dim(`  SSH: ${m.ssh_address ?? "(not set)"}`));
        console.log(chalk.dim(`  Last seen: ${m.last_seen_at}`));
      }
    });

  machinesCmd
    .command("register")
    .description("Register a machine")
    .argument("<name>", "Machine name")
    .option("--hostname <host>", "OS hostname")
    .option("--ssh <address>", "SSH address (e.g. user@host)")
    .option("--arch <arch>", "Architecture (e.g. linux-arm64)")
    .option("--primary", "Set as primary machine")
    .action((name: string, opts) => {
      try {
        const db = getDatabase();
        const machine = registerMachine(name, {
          hostname: opts.hostname,
          ssh_address: opts.ssh,
          primary: opts.primary,
        }, db);
        console.log(chalk.green(`Machine registered: ${machine.name} (${machine.id.slice(0, 8)})`));
        console.log(chalk.dim(`  Host: ${machine.hostname} | Platform: ${machine.platform}`));
        console.log(chalk.dim(`  Primary: ${machine.is_primary}`));
        if (machine.ssh_address) console.log(chalk.dim(`  SSH: ${machine.ssh_address}`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  machinesCmd
    .command("set-primary")
    .description("Set the primary machine")
    .argument("<name>", "Machine name")
    .action((name: string) => {
      try {
        const db = getDatabase();
        const machine = setPrimaryMachine(name, db);
        console.log(chalk.green(`Primary machine set to: ${machine.name} (${machine.id.slice(0, 8)})`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  machinesCmd
    .command("archive")
    .description("Archive a machine (soft-delete)")
    .argument("<name>", "Machine name")
    .action((name: string) => {
      try {
        const db = getDatabase();
        const machine = getMachineByName(name, db);
        if (!machine) {
          console.error(chalk.red(`Machine '${name}' not found`));
          process.exit(1);
        }
        archiveMachine(machine.id, db);
        console.log(chalk.green(`Machine '${name}' archived`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  machinesCmd
    .command("unarchive")
    .description("Unarchive a machine")
    .argument("<name>", "Machine name")
    .action((name: string) => {
      try {
        const db = getDatabase();
        const machine = getMachineByName(name, db);
        if (!machine) {
          console.error(chalk.red(`Machine '${name}' not found`));
          process.exit(1);
        }
        unarchiveMachine(machine.id, db);
        console.log(chalk.green(`Machine '${name}' unarchived`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  machinesCmd
    .command("delete")
    .description("Delete a machine (hard delete)")
    .argument("<name>", "Machine name")
    .action((name: string) => {
      try {
        const db = getDatabase();
        const machine = getMachineByName(name, db);
        if (!machine) {
          console.error(chalk.red(`Machine '${name}' not found`));
          process.exit(1);
        }
        deleteMachineDb(machine.id, db);
        console.log(chalk.green(`Machine '${name}' deleted`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  machinesCmd
    .command("status")
    .description("Show machine health status")
    .action(() => {
      const db = getDatabase();
      const machines = listMachines(db);
      const primary = getPrimaryMachine(db);

      if (machines.length === 0) {
        console.log(chalk.yellow("No machines registered."));
        return;
      }

      console.log(chalk.bold("\nMachine Health"));
      console.log(chalk.dim("─".repeat(60)));

      for (const m of machines) {
        const primaryTag = m.is_primary ? chalk.bold(" [PRIMARY]") : "";
        const lastSeen = new Date(m.last_seen_at);
        const nowDate = new Date();
        const diffMs = nowDate.getTime() - lastSeen.getTime();
        const diffMin = Math.round(diffMs / 60000);

        let status: string;
        if (diffMin < 5) {
          status = chalk.green("online");
        } else if (diffMin < 60) {
          status = chalk.yellow("stale");
        } else {
          status = chalk.red("offline");
        }

        console.log(
          `${chalk.cyan(m.name)}${primaryTag}  ${status}  last: ${diffMin}m ago`,
        );
      }

      if (!primary) {
        console.log(chalk.yellow("\nWarning: No primary machine set."));
        console.log(chalk.dim("Use `todos machines set-primary <name>` to set one."));
      }
    });

  // machines sync — pull tasks from remote machine(s) via SSH
  machinesCmd
    .command("sync")
    .description("Sync tasks from remote machine(s) via SSH")
    .option("--machine <name>", "Specific machine name (default: all with SSH)")
    .option("--dry-run", "Show what would be synced without importing")
    .option("--push", "Also push local tasks to remote machine")
    .action(async (opts) => {
      const { listTasks } = await import("../../db/tasks.js");
      const { getMachineId } = await import("../../db/machines.js");
      const db = getDatabase();
      const localName = getOrCreateLocalMachineName();
      const localMachineId = getMachineId();
      const machines = listMachines(db).filter((m) => m.ssh_address && m.name !== localName && !m.archived_at);

      const target = opts.machine ? machines.find((m) => m.name === opts.machine) : null;
      const toSync = target ? (machines.includes(target) ? [target] : []) : machines;

      if (toSync.length === 0) {
        console.log(chalk.dim(opts.machine ? `No SSH-configured machine named '${opts.machine}'.` : "No machines with SSH addresses to sync."));
        return;
      }

      let totalPulled = 0;
      for (const m of toSync) {
        const ssh = m.ssh_address!;
        const dbPath = findRemoteDbPath(ssh);
        if (!dbPath) {
          console.log(chalk.yellow(`  ${m.name}: no todos.db found`));
          continue;
        }

        if (opts.dryRun) {
          const json = remoteJsonDump(ssh, dbPath);
          const tasks = JSON.parse(json || "[]");
          console.log(chalk.cyan(`  ${m.name}: ${tasks.length} task(s) found`));
        } else {
          const json = remoteJsonDump(ssh, dbPath);
          const pulled = upsertTasks(json, m.id, localMachineId);
          totalPulled += pulled;
          console.log(chalk.green(`  ${m.name}: pulled ${pulled} task(s)`));
        }

        if (opts.push) {
          try {
            const localTasks = listTasks();
            const tmpFile = join(tmpdir(), `todos-export-${uuid()}.json`);
            writeFileSync(tmpFile, JSON.stringify(localTasks, null, 2));
            execSync(`scp ${tmpFile} ${ssh}:/tmp/todos-import.json`, { timeout: 15000 });
            const importCmd = `ssh ${ssh} 'node -e "const fs=require(\\'fs\\');const tasks=JSON.parse(fs.readFileSync(\\'/tmp/todos-import.json\\',\\'utf-8\\'));console.log(JSON.stringify(tasks.length))"'`;
            const count = execSync(importCmd, { encoding: "utf-8", timeout: 10000 }).trim();
            console.log(chalk.dim(`  ${m.name}: pushed ${count} local task(s) (manual import needed)`));
          } catch (e) {
            console.log(chalk.yellow(`  ${m.name}: push failed`));
          }
        }
      }

      if (!opts.dryRun) {
        console.log(chalk.bold(`\nSync complete: ${totalPulled} task(s) pulled.`));
      }
    });

  // machines tasks — list tasks from a remote machine
  machinesCmd
    .command("tasks")
    .description("List tasks from a remote machine via SSH")
    .argument("<machine-name>", "Machine name (must have SSH address)")
    .option("--status <status>", "Filter by status")
    .action((machineName: string, opts) => {
      const db = getDatabase();
      const machine = getMachineByName(machineName, db);
      if (!machine) {
        console.error(chalk.red(`Machine '${machineName}' not found`));
        process.exit(1);
      }
      if (!machine.ssh_address) {
        console.error(chalk.red(`Machine '${machineName}' has no SSH address`));
        process.exit(1);
      }

      const dbPath = findRemoteDbPath(machine.ssh_address);
      if (!dbPath) {
        console.error(chalk.red(`No todos.db found on ${machine.ssh_address}`));
        process.exit(1);
      }

      let json: string;
      try {
        json = remoteJsonDump(machine.ssh_address, dbPath);
      } catch {
        console.error(chalk.red(`Could not read tasks from ${machine.ssh_address}`));
        process.exit(1);
      }

      const tasks = JSON.parse(json || "[]");
      const filtered = opts.status ? tasks.filter((t: any) => t.status === opts.status) : tasks;

      if (filtered.length === 0) {
        console.log(chalk.dim(`No tasks on ${machineName}`));
        return;
      }

      console.log(chalk.bold(`${filtered.length} task(s) on ${machineName}:\n`));
      for (const t of filtered) {
        const check = t.status === "completed" ? "x" : " ";
        const prio = t.priority ? chalk.yellow(`[${t.priority}]`) : "";
        console.log(`  [${check}] ${t.short_id || t.id.slice(0, 8)} ${prio} ${t.title}`);
      }
    });
}
