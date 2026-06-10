import type { Command } from "commander";
import type { Machine } from "../../types/index.js";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, uuid } from "../../db/database.js";
import {
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  type LocalBridgeImportResult,
  type TodosLocalBridgeBundle,
} from "../../lib/local-bridge.js";
import {
  registerMachine,
  listMachines,
  getMachineByName,
  setPrimaryMachine,
  getPrimaryMachine,
  archiveMachine,
  unarchiveMachine,
  deleteMachine as deleteMachineDb,
  updateMachineHeartbeat,
  getMachineTopologyDiagnostics,
} from "../../db/machines.js";

function getOrCreateLocalMachineName(): string {
  return process.env["TODOS_MACHINE_NAME"] || require("node:os").hostname() || "unknown";
}

function wantsJson(program: Command, opts: Record<string, unknown>): boolean {
  return Boolean(opts["json"] || program.opts().json);
}

function metadataString(machine: Machine, key: string): string | null {
  const value = machine.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveMachineSshAddress(machine: Machine, localName: string): string | null {
  if (machine.ssh_address?.trim()) return machine.ssh_address.trim();
  const metadataAddress =
    metadataString(machine, "tailscale_name") ||
    metadataString(machine, "tailscale_ip") ||
    metadataString(machine, "lan_address");
  if (metadataAddress) return metadataAddress;
  if (machine.hostname && machine.hostname !== localName) return machine.hostname;
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runSsh(sshAddress: string, command: string, timeout = 30000): string {
  return execSync(
    `ssh ${shellQuote(sshAddress)} ${shellQuote(command)}`,
    { encoding: "utf-8", timeout },
  );
}

function scpFromRemote(sshAddress: string, remotePath: string, localPath: string): void {
  execSync(
    `scp ${shellQuote(`${sshAddress}:${remotePath}`)} ${shellQuote(localPath)}`,
    { timeout: 60000 },
  );
}

function scpToRemote(localPath: string, sshAddress: string, remotePath: string): void {
  execSync(
    `scp ${shellQuote(localPath)} ${shellQuote(`${sshAddress}:${remotePath}`)}`,
    { timeout: 60000 },
  );
}

function remoteTempPath(sshAddress: string): string {
  return runSsh(
    sshAddress,
    'mktemp "${TMPDIR:-/tmp}/todos-bridge-XXXXXX.json"',
    10000,
  ).trim();
}

function readRemoteBridgeBundle(sshAddress: string): TodosLocalBridgeBundle {
  const remotePath = remoteTempPath(sshAddress);
  const localPath = join(tmpdir(), `todos-bridge-pull-${uuid()}.json`);
  try {
    runSsh(
      sshAddress,
      `todos export --format bridge --allow-plaintext-sensitive --output ${shellQuote(remotePath)}`,
      120000,
    );
    scpFromRemote(sshAddress, remotePath, localPath);
    return JSON.parse(readFileSync(localPath, "utf-8")) as TodosLocalBridgeBundle;
  } finally {
    try { runSsh(sshAddress, `rm -f ${shellQuote(remotePath)}`, 10000); } catch {}
    try { unlinkSync(localPath); } catch {}
  }
}

function writeLocalBridgeBundle(): string {
  const localPath = join(tmpdir(), `todos-bridge-push-${uuid()}.json`);
  writeFileSync(localPath, JSON.stringify(createLocalBridgeBundle(), null, 2));
  return localPath;
}

function pushLocalBridgeBundle(sshAddress: string, dryRun: boolean): LocalBridgeImportResult {
  const localPath = writeLocalBridgeBundle();
  const remotePath = remoteTempPath(sshAddress);
  try {
    scpToRemote(localPath, sshAddress, remotePath);
    const applyFlag = dryRun ? "" : " --apply";
    const output = runSsh(
      sshAddress,
      `todos bridge-import ${shellQuote(remotePath)}${applyFlag} --resolve-conflicts --json`,
      120000,
    );
    return JSON.parse(output) as LocalBridgeImportResult;
  } finally {
    try { runSsh(sshAddress, `rm -f ${shellQuote(remotePath)}`, 10000); } catch {}
    try { unlinkSync(localPath); } catch {}
  }
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function formatBridgeImportSummary(result: LocalBridgeImportResult): string {
  const inserted = sumCounts(result.inserted);
  const merged = sumCounts(result.merged);
  const skipped = sumCounts(result.skipped);
  const conflicts = result.conflicts.length;
  const issues = result.issues.length;
  return `inserted ${inserted}, merged ${merged}, skipped ${skipped}, conflicts ${conflicts}, issues ${issues}`;
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
    .option("--platform <platform>", "OS platform")
    .option("--ssh <address>", "SSH address (e.g. user@host)")
    .option("--arch <arch>", "Architecture (e.g. linux-arm64)")
    .option("--tailscale-name <name>", "User-provided Tailscale/MagicDNS name")
    .option("--tailscale-ip <ip>", "User-provided Tailscale IP")
    .option("--lan-address <address>", "User-provided LAN address")
    .option("--workspace <path>", "Local workspace path for this machine")
    .option("--git-root <path>", "Local git root for this machine")
    .option("--primary", "Set as primary machine")
    .option("-j, --json", "Output as JSON")
    .action((name: string, opts) => {
      try {
        const db = getDatabase();
        const machine = registerMachine(name, {
          hostname: opts.hostname,
          platform: opts.platform,
          ssh_address: opts.ssh,
          arch: opts.arch,
          tailscale_name: opts.tailscaleName,
          tailscale_ip: opts.tailscaleIp,
          lan_address: opts.lanAddress,
          workspace_path: opts.workspace,
          git_root: opts.gitRoot,
          primary: opts.primary,
        }, db);
        if (wantsJson(program, opts)) {
          console.log(JSON.stringify(machine));
          return;
        }
        console.log(chalk.green(`Machine registered: ${machine.name} (${machine.id.slice(0, 8)})`));
        console.log(chalk.dim(`  Host: ${machine.hostname} | Platform: ${machine.platform}`));
        console.log(chalk.dim(`  Primary: ${machine.is_primary}`));
        if (machine.ssh_address) console.log(chalk.dim(`  SSH: ${machine.ssh_address}`));
        if (machine.metadata["tailscale_name"]) console.log(chalk.dim(`  Tailscale: ${machine.metadata["tailscale_name"]}`));
        if (machine.metadata["lan_address"]) console.log(chalk.dim(`  LAN: ${machine.metadata["lan_address"]}`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  machinesCmd
    .command("heartbeat [name]")
    .description("Update last-seen and local topology metadata for a machine")
    .option("--hostname <host>", "OS hostname")
    .option("--platform <platform>", "OS platform")
    .option("--ssh <address>", "SSH address (e.g. user@host)")
    .option("--arch <arch>", "Architecture (e.g. linux-arm64)")
    .option("--tailscale-name <name>", "User-provided Tailscale/MagicDNS name")
    .option("--tailscale-ip <ip>", "User-provided Tailscale IP")
    .option("--lan-address <address>", "User-provided LAN address")
    .option("--workspace <path>", "Local workspace path for this machine")
    .option("--git-root <path>", "Local git root for this machine")
    .option("-j, --json", "Output as JSON")
    .action((name: string | undefined, opts) => {
      try {
        const db = getDatabase();
        const machine = updateMachineHeartbeat(name, {
          hostname: opts.hostname,
          platform: opts.platform,
          ssh_address: opts.ssh,
          arch: opts.arch,
          tailscale_name: opts.tailscaleName,
          tailscale_ip: opts.tailscaleIp,
          lan_address: opts.lanAddress,
          workspace_path: opts.workspace,
          git_root: opts.gitRoot,
        }, db);
        if (wantsJson(program, opts)) {
          console.log(JSON.stringify(machine));
          return;
        }
        console.log(chalk.green(`Heartbeat recorded: ${machine.name} (${machine.id.slice(0, 8)})`));
        console.log(chalk.dim(`  Last seen: ${machine.last_seen_at}`));
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

  machinesCmd
    .command("topology")
    .description("Show local machine topology diagnostics")
    .option("--stale-minutes <n>", "Minutes before a machine is considered stale", "30")
    .option("--include-archived", "Include archived machines")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const staleMinutes = Number.parseInt(opts.staleMinutes, 10);
        if (!Number.isFinite(staleMinutes) || staleMinutes < 1) {
          console.error(chalk.red("Invalid --stale-minutes value. Must be a positive integer."));
          process.exit(1);
        }
        const diagnostics = getMachineTopologyDiagnostics({
          stale_minutes: staleMinutes,
          include_archived: opts.includeArchived,
        }, getDatabase());
        if (wantsJson(program, opts)) {
          console.log(JSON.stringify(diagnostics));
          return;
        }

        console.log(chalk.bold("\nMachine Topology"));
        console.log(chalk.dim("─".repeat(60)));
        for (const machine of diagnostics.machines) {
          const stale = machine.stale ? chalk.red(` stale ${machine.stale_minutes}m`) : chalk.green(" fresh");
          const ts = machine.topology.tailscale_ip ? ` ts:${machine.topology.tailscale_ip}` : "";
          const lan = machine.topology.lan_address ? ` lan:${machine.topology.lan_address}` : "";
          const workspace = machine.topology.workspace_path ? `\n  workspace: ${machine.topology.workspace_path}` : "";
          console.log(`${chalk.cyan(machine.name)}${stale}${chalk.dim(ts + lan)}${chalk.dim(workspace)}`);
        }
        if (diagnostics.path_issues.length > 0) {
          console.log(chalk.yellow(`\nPath diagnostics (${diagnostics.path_issues.length})`));
          for (const issue of diagnostics.path_issues) {
            console.log(chalk.yellow(`  ${issue.type}: ${issue.message}`));
          }
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  // machines sync — exchange bridge bundles with remote machine(s) via SSH.
  machinesCmd
    .command("sync")
    .description("Sync local bridge bundles with remote machine(s) via SSH")
    .option("--machine <name>", "Specific machine name (default: all with SSH)")
    .option("--ssh <address>", "Ad-hoc SSH address for bootstrap sync without a registered peer")
    .option("--dry-run", "Show what would be synced without importing")
    .option("--push", "Also push a local bridge bundle to the remote machine")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const db = getDatabase();
      const localName = getOrCreateLocalMachineName();
      const targets: Array<{ name: string; ssh: string }> = [];
      if (opts.ssh) {
        targets.push({ name: opts.machine || opts.ssh, ssh: opts.ssh });
      } else {
        const machines = listMachines(db).filter((m) => m.name !== localName && m.hostname !== localName && !m.archived_at);
        const selected = opts.machine ? machines.filter((m) => m.name === opts.machine) : machines;
        for (const machine of selected) {
          const ssh = resolveMachineSshAddress(machine, localName);
          if (ssh) targets.push({ name: machine.name, ssh });
        }
      }

      if (targets.length === 0) {
        if (wantsJson(program, opts)) {
          console.log(JSON.stringify({
            dry_run: Boolean(opts.dryRun),
            pushed: Boolean(opts.push),
            machines: [],
          }, null, 2));
          return;
        }
        console.log(chalk.dim(opts.machine ? `No remote SSH target found for machine '${opts.machine}'.` : "No remote machines with SSH addresses to sync."));
        return;
      }

      const results: Array<{
        machine: string;
        pull?: LocalBridgeImportResult;
        push?: LocalBridgeImportResult;
        error?: string;
      }> = [];
      for (const target of targets) {
        const ssh = target.ssh;
        try {
          const bundle = readRemoteBridgeBundle(ssh);
          const pull = importLocalBridgeBundle(bundle, {
            dryRun: Boolean(opts.dryRun),
            conflictStrategy: "safe_merge",
          }, db);
          const record: typeof results[number] = { machine: target.name, pull };
          if (!wantsJson(program, opts)) {
            const mode = opts.dryRun ? "would pull" : "pulled";
            console.log(chalk.green(`  ${target.name}: ${mode} ${formatBridgeImportSummary(pull)}`));
          }

          if (opts.push) {
            const push = pushLocalBridgeBundle(ssh, Boolean(opts.dryRun));
            record.push = push;
            if (!wantsJson(program, opts)) {
              const mode = opts.dryRun ? "would push" : "pushed";
              console.log(chalk.green(`  ${target.name}: ${mode} ${formatBridgeImportSummary(push)}`));
            }
          }
          results.push(record);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ machine: target.name, error: message });
          if (!wantsJson(program, opts)) console.log(chalk.yellow(`  ${target.name}: sync failed: ${message}`));
        }
      }

      if (wantsJson(program, opts)) {
        console.log(JSON.stringify({
          dry_run: Boolean(opts.dryRun),
          pushed: Boolean(opts.push),
          machines: results,
        }, null, 2));
        return;
      }
      console.log(chalk.bold(`\nSync ${opts.dryRun ? "dry-run" : "complete"}: ${results.length} machine(s) checked.`));
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
      const sshAddress = resolveMachineSshAddress(machine, getOrCreateLocalMachineName());
      if (!sshAddress) {
        console.error(chalk.red(`Machine '${machineName}' has no SSH address`));
        process.exit(1);
      }

      try {
        const bundle = readRemoteBridgeBundle(sshAddress);
        const tasks = bundle.data.tasks;
        const filtered = opts.status ? tasks.filter((t) => t.status === opts.status) : tasks;

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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Could not read tasks from ${sshAddress}: ${message}`));
        process.exit(1);
      }
    });
}
