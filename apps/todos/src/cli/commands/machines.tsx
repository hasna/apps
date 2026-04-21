import type { Command } from "commander";
import chalk from "chalk";
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
import { getDatabase } from "../../db/database.js";

export function registerMachineCommands(program: Command) {
  // machines
  program
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

  // machines register
  program
    .command("machines register")
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

  // machines set-primary
  program
    .command("machines set-primary")
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

  // machines archive
  program
    .command("machines archive")
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

  // machines unarchive
  program
    .command("machines unarchive")
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

  // machines delete
  program
    .command("machines delete")
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

  // machines status
  program
    .command("machines status")
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
        const now = new Date();
        const diffMs = now.getTime() - lastSeen.getTime();
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
}
