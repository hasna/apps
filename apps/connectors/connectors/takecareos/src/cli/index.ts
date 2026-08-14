#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { TakeCareOS } from "../api/index";
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
} from "../utils/config";
import type { OutputFormat } from "../utils/output";
import { success, error, info, print, setVerboseMode, debug } from "../utils/output";

const CONNECTOR_NAME = "takecareos";
const VERSION = "0.1.0";

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description("TakeCareOS connector CLI — home-care agency clients, caregivers, shifts, incidents, compliance")
  .version(VERSION)
  .option("-k, --api-key <key>", "API key (overrides config)")
  .option("-f, --format <format>", "Output format (json, pretty)", "pretty")
  .option("-p, --profile <profile>", "Use a specific profile")
  .option("-v, --verbose", "Enable verbose output for debugging")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
      debug("Verbose mode enabled");
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }
    if (opts.apiKey) {
      process.env.TAKECAREOS_API_KEY = opts.apiKey;
      debug("API key set from command line flag");
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format as OutputFormat | undefined;
    if (fmt) return fmt;
    node = node.parent;
  }
  return "pretty";
}

function getClient(): TakeCareOS {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TAKECAREOS_API_KEY.`);
    process.exit(1);
  }
  return new TakeCareOS({ apiKey, baseUrl: getBaseUrl() });
}

async function run(action: () => Promise<unknown>, cmd: Command): Promise<void> {
  try {
    const result = await action();
    print(result, getFormat(cmd));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── Profile commands ──────────────────────────────────────────
const profileCmd = program.command("profile").description("Manage configuration profiles");

profileCmd
  .command("list")
  .description("List all profiles")
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }
    success("Profiles:");
    profiles.forEach((p) => console.log(`  ${p}${p === current ? chalk.green(" (active)") : ""}`));
  });

profileCmd
  .command("use <name>")
  .description("Switch to a profile")
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command("create <name>")
  .description("Create a new profile")
  .option("--api-key <key>", "API key")
  .option("--base-url <url>", "Base URL override")
  .option("--use", "Switch to this profile after creation")
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command("delete <name>")
  .description("Delete a profile")
  .action((name: string) => {
    if (name === "default") {
      error("Cannot delete the default profile");
      process.exit(1);
    }
    if (deleteProfile(name)) success(`Profile "${name}" deleted`);
    else {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
  });

profileCmd
  .command("show [name]")
  .description("Show profile configuration")
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(" (active)") : ""}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray("not set")}`);
    info(`Base URL: ${config.baseUrl || chalk.gray("default")}`);
  });

// ── Config commands ───────────────────────────────────────────
const configCmd = program.command("config").description("Manage CLI configuration (for active profile)");

configCmd
  .command("set-key <apiKey>")
  .description("Set API key")
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command("set-base-url <url>")
  .description("Set base URL override")
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command("show")
  .description("Show current configuration")
  .action(() => {
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    const apiKey = getApiKey();
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray("not set")}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray("default")}`);
  });

configCmd
  .command("clear")
  .description("Clear configuration for active profile")
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ── Clients ───────────────────────────────────────────────────
const clientsCmd = program.command("clients").description("Care recipients / clients");

clientsCmd
  .command("list")
  .description("List clients")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--per-page <n>", "Results per page", (v) => parseInt(v, 10))
  .option("--status <status>", "Filter by status")
  .action((opts, cmd: Command) =>
    run(() => getClient().listClients({ page: opts.page, perPage: opts.perPage, status: opts.status }), cmd),
  );

clientsCmd
  .command("get <clientId>")
  .description("Get a client by ID")
  .action((clientId: string, _opts, cmd: Command) => run(() => getClient().getClient(clientId), cmd));

// ── Caregivers ────────────────────────────────────────────────
const caregiversCmd = program.command("caregivers").description("Caregivers / field workers");

caregiversCmd
  .command("list")
  .description("List caregivers")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--per-page <n>", "Results per page", (v) => parseInt(v, 10))
  .option("--status <status>", "Filter by status")
  .action((opts, cmd: Command) =>
    run(() => getClient().listCaregivers({ page: opts.page, perPage: opts.perPage, status: opts.status }), cmd),
  );

// ── Shifts ────────────────────────────────────────────────────
const shiftsCmd = program.command("shifts").description("Scheduled visits / shifts");

shiftsCmd
  .command("list")
  .description("List shifts")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--per-page <n>", "Results per page", (v) => parseInt(v, 10))
  .option("--status <status>", "Filter by status")
  .option("--client-id <id>", "Filter by client")
  .option("--caregiver-id <id>", "Filter by caregiver")
  .option("--from <date>", "Start of date range (ISO 8601)")
  .option("--to <date>", "End of date range (ISO 8601)")
  .action((opts, cmd: Command) =>
    run(
      () =>
        getClient().listShifts({
          page: opts.page,
          perPage: opts.perPage,
          status: opts.status,
          clientId: opts.clientId,
          caregiverId: opts.caregiverId,
          from: opts.from,
          to: opts.to,
        }),
      cmd,
    ),
  );

shiftsCmd
  .command("create")
  .description("Schedule a new shift")
  .requiredOption("--client-id <id>", "Client ID")
  .requiredOption("--start <time>", "Start time (ISO 8601)")
  .requiredOption("--end <time>", "End time (ISO 8601)")
  .option("--caregiver-id <id>", "Caregiver ID")
  .option("--service-type <type>", "Service type")
  .option("--notes <notes>", "Notes")
  .action((opts, cmd: Command) =>
    run(
      () =>
        getClient().createShift({
          client_id: opts.clientId,
          start_time: opts.start,
          end_time: opts.end,
          caregiver_id: opts.caregiverId,
          service_type: opts.serviceType,
          notes: opts.notes,
        }),
      cmd,
    ),
  );

// ── Incidents ─────────────────────────────────────────────────
const incidentsCmd = program.command("incidents").description("Incident reports");

incidentsCmd
  .command("list")
  .description("List incidents")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--per-page <n>", "Results per page", (v) => parseInt(v, 10))
  .option("--status <status>", "Filter by status")
  .option("--client-id <id>", "Filter by client")
  .option("--severity <severity>", "Filter by severity")
  .action((opts, cmd: Command) =>
    run(
      () =>
        getClient().listIncidents({
          page: opts.page,
          perPage: opts.perPage,
          status: opts.status,
          clientId: opts.clientId,
          severity: opts.severity,
        }),
      cmd,
    ),
  );

incidentsCmd
  .command("create")
  .description("File a new incident report")
  .requiredOption("--type <type>", "Incident type")
  .requiredOption("--description <text>", "Description")
  .option("--client-id <id>", "Client ID")
  .option("--caregiver-id <id>", "Caregiver ID")
  .option("--shift-id <id>", "Shift ID")
  .option("--severity <severity>", "Severity")
  .action((opts, cmd: Command) =>
    run(
      () =>
        getClient().createIncident({
          type: opts.type,
          description: opts.description,
          client_id: opts.clientId,
          caregiver_id: opts.caregiverId,
          shift_id: opts.shiftId,
          severity: opts.severity,
        }),
      cmd,
    ),
  );

// ── Invoices ──────────────────────────────────────────────────
const invoicesCmd = program.command("invoices").description("Client invoices");

invoicesCmd
  .command("list")
  .description("List invoices")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--per-page <n>", "Results per page", (v) => parseInt(v, 10))
  .option("--status <status>", "Filter by status")
  .option("--client-id <id>", "Filter by client")
  .action((opts, cmd: Command) =>
    run(
      () =>
        getClient().listInvoices({
          page: opts.page,
          perPage: opts.perPage,
          status: opts.status,
          clientId: opts.clientId,
        }),
      cmd,
    ),
  );

// ── Compliance ────────────────────────────────────────────────
const complianceCmd = program.command("compliance").description("Compliance reporting");

complianceCmd
  .command("report")
  .description("Get the agency compliance report")
  .option("--from <date>", "Start of period (ISO 8601)")
  .option("--to <date>", "End of period (ISO 8601)")
  .action((opts, cmd: Command) =>
    run(() => getClient().getComplianceReport({ from: opts.from, to: opts.to }), cmd),
  );

program.parse();
