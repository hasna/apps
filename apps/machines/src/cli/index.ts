#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { getPackageVersion } from "../version.js";
import {
  manifestAdd,
  manifestBootstrapCurrentMachine,
  manifestGet,
  manifestInit,
  manifestList,
  manifestRemove,
  manifestValidate,
} from "../commands/manifest.js";
import { buildSetupPlan, runSetup } from "../commands/setup.js";
import { buildBackupPlan, runBackup } from "../commands/backup.js";
import { buildCertPlan, runCertPlan } from "../commands/cert.js";
import { addDomainMapping, listDomainMappings, renderDomainMapping } from "../commands/dns.js";
import { diffMachines } from "../commands/diff.js";
import { buildAppsPlan, listApps, runAppsInstall } from "../commands/apps.js";
import { buildClaudeInstallPlan, runClaudeInstall } from "../commands/install-claude.js";
import { buildTailscaleInstallPlan, runTailscaleInstall } from "../commands/install-tailscale.js";
import {
  addNotificationChannel,
  listNotificationChannels,
  removeNotificationChannel,
  testNotificationChannel,
} from "../commands/notifications.js";
import { listPorts } from "../commands/ports.js";
import { buildSshCommand, resolveSshTarget } from "../commands/ssh.js";
import { buildSyncPlan, runSync } from "../commands/sync.js";
import { getStatus } from "../commands/status.js";
import { getServeInfo, startDashboardServer } from "../commands/serve.js";
import { getManifestPath } from "../paths.js";
import type { MachineManifest } from "../types.js";

const program = new Command();

program
  .name("machines")
  .description("Machine fleet management CLI + MCP for developers")
  .version(getPackageVersion());

const manifestCommand = program.command("manifest").description("Manage the fleet manifest");
const appsCommand = program.command("apps").description("Manage installed applications per machine");

manifestCommand
  .command("init")
  .description("Create an empty fleet manifest")
  .action(() => {
    console.log(manifestInit());
  });

manifestCommand
  .command("path")
  .description("Print the manifest path")
  .action(() => {
    console.log(getManifestPath());
  });

manifestCommand
  .command("list")
  .description("Print the fleet manifest")
  .action(() => {
    console.log(JSON.stringify(manifestList(), null, 2));
  });

manifestCommand
  .command("validate")
  .description("Validate the fleet manifest")
  .action(() => {
    console.log(JSON.stringify(manifestValidate(), null, 2));
  });

manifestCommand
  .command("bootstrap")
  .description("Detect and upsert the current machine into the manifest")
  .action(() => {
    console.log(JSON.stringify(manifestBootstrapCurrentMachine(), null, 2));
  });

manifestCommand
  .command("get")
  .description("Print a single machine from the manifest")
  .argument("<id>", "Machine identifier")
  .action((id: string) => {
    const machine = manifestGet(id);
    if (!machine) {
      process.exitCode = 1;
      console.error(`Machine not found: ${id}`);
      return;
    }
    console.log(JSON.stringify(machine, null, 2));
  });

manifestCommand
  .command("remove")
  .description("Remove a machine from the manifest")
  .argument("<id>", "Machine identifier")
  .action((id: string) => {
    console.log(JSON.stringify(manifestRemove(id), null, 2));
  });

manifestCommand
  .command("add")
  .description("Add or replace a machine in the fleet manifest")
  .requiredOption("--id <id>", "Machine identifier")
  .requiredOption("--platform <platform>", "linux | macos | windows")
  .requiredOption("--workspace-path <path>", "Primary workspace path")
  .option("--hostname <hostname>", "Machine hostname")
  .option("--ssh-address <sshAddress>", "Machine SSH address")
  .option("--tailscale-name <tailscaleName>", "Machine Tailscale DNS name")
  .option("--connection <connection>", "local | ssh | tailscale")
  .option("--bun-path <path>", "Bun executable directory")
  .option("--tag <tag...>", "Machine tags")
  .option("--package <name...>", "Desired packages")
  .option("--app <spec...>", "Desired apps as name[:manager[:packageName]]")
  .option("--file <spec...>", "File sync spec source:target[:copy|symlink]")
  .action((options: Record<string, string | string[] | undefined>) => {
    const packages = Array.isArray(options["package"])
      ? options["package"].map((name) => ({ name: String(name) }))
      : undefined;
    const files = Array.isArray(options["file"])
      ? options["file"].map((value) => {
          const [source, target, mode] = String(value).split(":");
          const normalizedMode: "copy" | "symlink" | undefined =
            mode === "symlink" ? "symlink" : mode === "copy" ? "copy" : undefined;
          return {
            source,
            target,
            mode: normalizedMode,
          };
        })
      : undefined;
    const apps = Array.isArray(options["app"])
      ? options["app"].map((value) => {
          const [name, manager, packageName] = String(value).split(":");
          return {
            name,
            manager: manager as "brew" | "cask" | "apt" | "winget" | "custom" | undefined,
            packageName,
          };
        })
      : undefined;
    const machine: MachineManifest = {
      id: String(options["id"]),
      hostname: options["hostname"] ? String(options["hostname"]) : undefined,
      sshAddress: options["sshAddress"] ? String(options["sshAddress"]) : undefined,
      tailscaleName: options["tailscaleName"] ? String(options["tailscaleName"]) : undefined,
      platform: String(options["platform"]) as MachineManifest["platform"],
      connection: options["connection"] ? String(options["connection"]) as MachineManifest["connection"] : undefined,
      workspacePath: String(options["workspacePath"]),
      bunPath: options["bunPath"] ? String(options["bunPath"]) : undefined,
      tags: Array.isArray(options["tag"]) ? options["tag"].map(String) : undefined,
      packages,
      apps,
      files,
    };
    console.log(JSON.stringify(manifestAdd(machine), null, 2));
  });

appsCommand
  .command("list")
  .description("List manifest-managed apps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; json?: boolean }) => {
    const result = listApps(options.machine);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

appsCommand
  .command("plan")
  .description("Preview app install steps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; json?: boolean }) => {
    const result = buildAppsPlan(options.machine);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

appsCommand
  .command("apply")
  .description("Install manifest-managed apps for a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--yes", "Confirm execution", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; yes?: boolean; json?: boolean }) => {
    const result = runAppsInstall(options.machine, { apply: true, yes: options.yes });
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

program
  .command("setup")
  .description("Prepare a machine from the fleet manifest")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute provisioning commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply ? runSetup(options.machine, { apply: true, yes: options.yes }) : buildSetupPlan(options.machine);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("sync")
  .description("Reconcile a machine against the fleet manifest")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute reconciliation commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply ? runSync(options.machine, { apply: true, yes: options.yes }) : buildSyncPlan(options.machine);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("diff")
  .description("Show manifest differences between two machines")
  .requiredOption("--left <id>", "Left machine identifier")
  .option("--right <id>", "Right machine identifier (defaults to current machine)")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { left: string; right?: string; json?: boolean }) => {
    const result = diffMachines(options.left, options.right);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("backup")
  .description("Create and optionally upload a machine backup archive")
  .requiredOption("--bucket <name>", "S3 bucket name")
  .option("--prefix <prefix>", "S3 key prefix", "machines")
  .option("--apply", "Execute backup commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { bucket: string; prefix: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply
      ? runBackup(options.bucket, options.prefix, { apply: true, yes: options.yes })
      : buildBackupPlan(options.bucket, options.prefix);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

const certCommand = program.command("cert").description("Manage mkcert-based local SSL certificates");

certCommand
  .command("issue")
  .description("Plan or issue certificates for one or more domains")
  .argument("<domains...>", "Domains to include in the certificate")
  .option("--apply", "Execute certificate commands instead of previewing them", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((domains: string[], options: { apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply ? runCertPlan(domains, { apply: true, yes: options.yes }) : buildCertPlan(domains);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

const dnsCommand = program.command("dns").description("Manage local domain mappings");
const notificationsCommand = program.command("notifications").description("Manage fleet alert delivery channels");

dnsCommand
  .command("add")
  .description("Add or replace a local domain mapping")
  .requiredOption("--domain <domain>", "Domain name")
  .requiredOption("--port <port>", "Target port")
  .option("--target-host <host>", "Target host", "127.0.0.1")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { domain: string; port: string; targetHost: string; json?: boolean }) => {
    const result = addDomainMapping(options.domain, Number.parseInt(options.port, 10), options.targetHost);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

dnsCommand
  .command("list")
  .description("List saved local domain mappings")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const result = listDomainMappings();
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

notificationsCommand
  .command("add")
  .description("Add or replace a notification channel")
  .requiredOption("--id <id>", "Channel identifier")
  .requiredOption("--type <type>", "email | webhook | command")
  .requiredOption("--target <target>", "Email, webhook URL, or shell command")
  .option("--event <event...>", "Events routed to this channel", ["setup_failed", "sync_failed"])
  .option("--disabled", "Create the channel in disabled state", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { id: string; type: "email" | "webhook" | "command"; target: string; event: string[]; disabled?: boolean; json?: boolean }) => {
    const result = addNotificationChannel({
      id: options.id,
      type: options.type,
      target: options.target,
      events: options.event,
      enabled: !options.disabled,
    });
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

notificationsCommand
  .command("list")
  .description("List configured notification channels")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const result = listNotificationChannels();
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

notificationsCommand
  .command("test")
  .description("Preview or execute a notification test")
  .requiredOption("--channel <id>", "Channel identifier")
  .option("--event <name>", "Event name", "manual.test")
  .option("--message <message>", "Test message", "machines notification test")
  .option("--apply", "Execute the notification test instead of previewing it", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { channel: string; event: string; message: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = testNotificationChannel(options.channel, options.event, options.message, {
      apply: options.apply,
      yes: options.yes,
    });
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

notificationsCommand
  .command("remove")
  .description("Remove a notification channel")
  .argument("<id>", "Channel identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((id: string, options: { json?: boolean }) => {
    const result = removeNotificationChannel(id);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

dnsCommand
  .command("render")
  .description("Render hosts/proxy configuration for a domain")
  .argument("<domain>", "Domain name")
  .option("-j, --json", "Print JSON output", false)
  .action((domain: string, options: { json?: boolean }) => {
    const result = renderDomainMapping(domain);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

program
  .command("install-claude")
  .description("Install or update Claude, Codex, and Gemini CLIs across the fleet")
  .option("--machine <id>", "Machine identifier")
  .option("--tool <name...>", "CLI tools to install (claude, codex, gemini)")
  .option("--apply", "Execute installation commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; tool?: string[]; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply
      ? runClaudeInstall(options.machine, options.tool, { apply: true, yes: options.yes })
      : buildClaudeInstallPlan(options.machine, options.tool);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

program
  .command("install-tailscale")
  .description("Install Tailscale on a machine")
  .option("--machine <id>", "Machine identifier")
  .option("--apply", "Execute installation commands instead of previewing the plan", false)
  .option("--yes", "Confirm execution when using --apply", false)
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
    const result = options.apply
      ? runTailscaleInstall(options.machine, { apply: true, yes: options.yes })
      : buildTailscaleInstallPlan(options.machine);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

program
  .command("ssh")
  .description("Choose the best SSH route for a machine")
  .requiredOption("--machine <id>", "Machine identifier")
  .option("--cmd <command>", "Remote command to run")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine: string; cmd?: string; json?: boolean }) => {
    if (options.json) {
      console.log(JSON.stringify(resolveSshTarget(options.machine), null, 2));
      return;
    }
    console.log(buildSshCommand(options.machine, options.cmd));
  });

program
  .command("ports")
  .description("List listening ports on a machine")
  .option("--machine <id>", "Machine identifier")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { machine?: string; json?: boolean }) => {
    const result = listPorts(options.machine);
    const rendered = JSON.stringify(result, null, 2);
    console.log(options.json ? rendered : rendered);
  });

program
  .command("status")
  .description("Print local machine and storage status")
  .option("-j, --json", "Print JSON output", false)
  .action((options: { json?: boolean }) => {
    const status = getStatus();
    const rendered = JSON.stringify(status, null, 2);
    console.log(options.json ? rendered : chalk.cyan(rendered));
  });

program
  .command("serve")
  .description("Serve a local fleet dashboard and JSON API")
  .option("--host <host>", "Host interface to bind", "0.0.0.0")
  .option("--port <port>", "Port to bind", "7676")
  .option("-j, --json", "Print serve config and exit", false)
  .action((options: { host: string; port: string; json?: boolean }) => {
    const info = getServeInfo({
      host: options.host,
      port: Number.parseInt(options.port, 10),
    });

    if (options.json) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    const server = startDashboardServer({
      host: info.host,
      port: info.port,
    });
    console.log(chalk.green(`machines dashboard listening on http://${server.hostname}:${server.port}`));
  });

await program.parseAsync(process.argv);
