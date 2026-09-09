import type { Command } from "commander";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import { cloudListTasks, getTodosCloudClient } from "../cloud-router.js";
import { cloudMachineAction, cloudMachines, localMachineOptions } from "../machine-api.js";
import type { MachineAction } from "../../storage/machine-registry.js";

export function registerApiMachineCommands(program: Command, client?: HasnaStorageClient): void {
  const getClient = () => {
    if (!client) {
      const resolved = getTodosCloudClient();
      if (!resolved) throw new Error("Authenticated Todos API client required for shared machine operations");
      client = resolved;
    }
    return client;
  };
  const emit = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  const group = program.command("machines").description("Manage the shared API machine registry").option("-a, --all", "Include archived machines").option("-j, --json", "Output JSON").action(async opts => emit((await cloudMachines(getClient())).filter(row => opts.all || !row.archived_at)));
  for (const action of ["register", "heartbeat"] as const) {
    group.command(action === "register" ? "register <name>" : "heartbeat [name]")
      .description("Register or refresh a machine in the shared API; preserve its existing identity")
      .option("--id <id>", "Reusable stable machine ID for registration")
      .option("--hostname <host>", "OS hostname").option("--platform <platform>", "OS platform")
      .option("--ssh <address>", "SSH metadata").option("--arch <arch>", "Architecture")
      .option("--tailscale-name <name>", "Tailscale name").option("--tailscale-ip <ip>", "Tailscale IP")
      .option("--lan-address <address>", "LAN address").option("--workspace <path>", "Workstation workspace path")
      .option("--git-root <path>", "Workstation git root").option("--primary", "Set as primary")
      .option("-j, --json", "Output JSON").action(async (name, opts) => {
        emit(await cloudMachineAction(getClient(), { action, name: name ?? process.env.HASNA_TODOS_MACHINE_NAME ?? process.env.TODOS_MACHINE_NAME ?? hostname(), id: opts.id, options: localMachineOptions({ hostname: opts.hostname, platform: opts.platform, ssh_address: opts.ssh, arch: opts.arch, tailscale_name: opts.tailscaleName, tailscale_ip: opts.tailscaleIp, lan_address: opts.lanAddress, workspace_path: opts.workspace, git_root: opts.gitRoot, primary: opts.primary }) }));
      });
  }
  for (const action of ["set-primary", "archive", "unarchive", "delete"] as MachineAction[]) {
    group.command(`${action} <name>`).option("-j, --json", "Output JSON").action(async name => emit(await cloudMachineAction(getClient(), { action, name })));
  }
  for (const name of ["status", "topology"]) group.command(name).option("--stale-minutes <n>", "Stale heartbeat threshold", "30").option("--include-archived", "Include archived machines").option("-j, --json", "Output JSON").action(async opts => {
    const minutes = Number(opts.staleMinutes);
    if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error("--stale-minutes must be a positive integer");
    const machines = (await cloudMachines(getClient())).filter(row => opts.includeArchived || !row.archived_at);
    emit({ source: "api", generated_at: new Date().toISOString(), filesystem_checked: false, machines: machines.map(row => ({ ...row, stale: Date.now() - Date.parse(row.last_seen_at) > minutes * 60000 })) });
  });
  group.command("import <snapshot>").description("Import complete machine records from a snapshot; refuse any divergent identity").option("-j, --json", "Output JSON").action(async path => {
    const authority = getClient();
    const snapshot = JSON.parse(await readFile(path, "utf8"));
    emit(await cloudMachineAction(authority, { action: "import", machines: snapshot.machines }));
  });
  group.command("sync").description("Read the authoritative shared registry; no SSH transfer is needed for API clients")
    .option("--machine <name>", "Filter the shared registry").option("--ssh <address>", "Retired bridge option")
    .option("--push", "Retired bridge option").option("--dry-run", "Read-only registry inspection").option("-j, --json", "Output JSON").action(async opts => {
      if (opts.ssh || opts.push) throw new Error("SSH bridge transfer is not an API registry operation; export the legacy snapshot explicitly and use machines import after upgrading the server");
      const machines = (await cloudMachines(getClient())).filter(row => !opts.machine || row.name === opts.machine);
      if (opts.machine && !machines.length) throw new Error("Machine not found");
      emit({ source: "api", transfer_performed: false, machines });
    });
  group.command("tasks <machine-name>").description("List shared tasks attributed to a machine")
    .option("--status <status>", "Task status filter").option("-j, --json", "Output JSON").action(async (name, opts) => {
      const matches = (await cloudMachines(getClient())).filter(row => row.name === name || row.id === name);
      if (matches.length > 1) throw new Error("Machine selector is ambiguous between a name and another identity");
      const machine = matches[0];
      if (!machine) throw new Error("Machine not found");
      const tasks = await cloudListTasks(getClient(), { include_subtasks: true, ...(opts.status ? { status: opts.status } : {}) });
      emit(tasks.filter(row => row.machine_id === machine.id));
    });
}
