import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ComputersError, VERSION, type AuthorizationContext, type CreateComputerInput, type ExecRequest, type InstallPolicyRule, type PackageSpec } from "./contracts";
import { ComputersService } from "./service";
import { SQLiteStorage } from "./storage";
import { createLocalProviderPortsFromConfigFile } from "./local";
import { runLocalMacCanary } from "./local-canary";

const LOCAL_CONTEXT: AuthorizationContext = {
  tenantId: "tenant_local", principalId: "principal_local", scopes: ["computers:admin"], authMethod: "loopback_dev",
};

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (value === undefined) throw new ComputersError("invalid_request", `--${name} is required`, 400);
  return value;
}

function parseJsonFlag<T>(args: string[], name: string): T {
  const value = requiredFlag(args, name);
  try { return JSON.parse(value) as T; }
  catch { throw new ComputersError("invalid_request", `--${name} must be valid JSON`, 400); }
}

function databasePath(args: string[]): string {
  const value = flag(args, "db") ?? Bun.env.COMPUTERS_DB ?? "./computers.db";
  if (value === ":memory:") return value;
  if (value.includes("\0")) throw new ComputersError("invalid_request", "Invalid database path", 400);
  return resolve(value);
}

function openService(args: string[]): { storage: SQLiteStorage; service: ComputersService } {
  const path = databasePath(args);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const storage = new SQLiteStorage(path);
  storage.migrate();
  const localConfig = flag(args, "local-config") ?? Bun.env.COMPUTERS_LOCAL_CONFIG;
  return { storage, service: new ComputersService(storage, localConfig === undefined ? {} : { providers: createLocalProviderPortsFromConfigFile(resolve(localConfig)) }) };
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function schemaVersion(storage: SQLiteStorage): number {
  return (storage.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version;
}

export const CLI_HELP = `Computers ${VERSION}

Usage: computers <command>

Commands:
  init [--db PATH]
  serve
  worker
  doctor [--db PATH]
  db migrate [--db PATH]
  computer create|adopt|list|get|status|start|stop|quarantine|delete
  operations [--computer ID]
  exec request --computer ID --argv JSON --idempotency-key KEY
  install plan|apply|history
  snapshot list|create
  assignments list
  policies list|set
  grants create|list (create requires bounded child owners, regions, profiles, storage, uptime, and budget)
  profiles create|list
  provider readiness
  local config validate|probe|canary

Requests return a truthful pending operation. A worker records provider_not_configured as a definite failed outcome when no adapter is configured; no desired state is claimed early.
`;

export async function runCli(args = Bun.argv.slice(2)): Promise<number> {
  if (args.length === 0 || args[0] === "help" || args.includes("--help")) { process.stdout.write(CLI_HELP); return 0; }
  if (args.includes("--version")) { process.stdout.write(`${VERSION}\n`); return 0; }
  const command = args[0];
  if (command === "serve") {
    const child = Bun.spawn(["computers-serve", ...args.slice(1)], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    return child.exited;
  }
  if (command === "worker") {
    const child = Bun.spawn(["computers-worker", ...args.slice(1)], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    return child.exited;
  }
  if (command === "local" && args[1] === "config") {
    const action = args[2]; const localConfig = resolve(requiredFlag(args, "local-config"));
    if (action === "validate" || action === "probe") {
      const providers = createLocalProviderPortsFromConfigFile(localConfig); const readiness = await Promise.all(Object.values(providers).map((provider) => provider.readiness()));
      output(action === "validate" ? { valid: true, providers: readiness } : { data: readiness, platform: process.platform, arch: process.arch, liveMacCanaryRun: false }); return 0;
    }
    if (action === "canary") { output(await runLocalMacCanary(localConfig, requiredFlag(args, "db"), requiredFlag(args, "confirm"))); return 0; }
    throw new ComputersError("unsupported_operation", "Unsupported command", 400);
  }
  const { storage, service } = openService(args);
  try {
    if (command === "init" || (command === "db" && args[1] === "migrate")) { output({ migrated: true, database: databasePath(args), version: schemaVersion(storage) }); return 0; }
    if (command === "doctor") { output({ ready: storage.ready(), database: databasePath(args), providers: await service.providerReadiness(LOCAL_CONTEXT), resident: { protocolOnly: true, mtlsTransport: false, privilegedDaemon: false } }); return storage.ready() ? 0 : 1; }
    if (command === "computer") {
      const action = args[1];
      if (action === "list") { output({ data: service.listComputers(LOCAL_CONTEXT) }); return 0; }
      if (action === "get") { output(service.getComputer(LOCAL_CONTEXT, requiredFlag(args, "id"))); return 0; }
      if (action === "status") {
        const computer = service.getComputer(LOCAL_CONTEXT, requiredFlag(args, "id"));
        output({ computer, operations: service.listOperations(LOCAL_CONTEXT, computer.id), provider: (await service.providerReadiness(LOCAL_CONTEXT)).find((item) => item.provider === computer.provider) });
        return 0;
      }
      if (action === "create") {
        const input: CreateComputerInput = {
          slug: requiredFlag(args, "slug"), provider: requiredFlag(args, "provider") as CreateComputerInput["provider"],
          ownerPrincipalId: flag(args, "owner") ?? LOCAL_CONTEXT.principalId, idempotencyKey: requiredFlag(args, "idempotency-key"),
        };
        const parent = flag(args, "parent"); if (parent !== undefined) input.parentComputerId = parent;
        const grant = flag(args, "grant"); if (grant !== undefined) input.grantId = grant;
        const region = flag(args, "region"); if (region !== undefined) input.region = region;
        const profileId = flag(args, "profile"); if (profileId !== undefined) input.profileId = profileId;
        const storageGiB = flag(args, "storage-gib"); if (storageGiB !== undefined) input.storageGiB = Number(storageGiB);
        const uptimeSeconds = flag(args, "uptime-seconds"); if (uptimeSeconds !== undefined) input.uptimeSeconds = Number(uptimeSeconds);
        const budgetMicros = flag(args, "budget-micros"); if (budgetMicros !== undefined) input.budgetMicros = Number(budgetMicros);
        const computer = service.createComputer(LOCAL_CONTEXT, input);
        output({ computer, operation: service.listOperations(LOCAL_CONTEXT, computer.id).find((item) => item.kind === "create") }); return 0;
      }
      if (action === "adopt") {
        const adoption = { slug: requiredFlag(args, "slug"), ownerPrincipalId: flag(args, "owner") ?? LOCAL_CONTEXT.principalId,
          adoptionId: requiredFlag(args, "adoption"), idempotencyKey: requiredFlag(args, "idempotency-key") };
        const profileId = flag(args, "profile"); output(service.adoptComputer(LOCAL_CONTEXT, profileId === undefined ? adoption : { ...adoption, profileId })); return 0;
      }
      if (action === "start" || action === "stop" || action === "quarantine" || action === "delete") {
        output(service.requestLifecycle(LOCAL_CONTEXT, requiredFlag(args, "id"), action, requiredFlag(args, "idempotency-key"))); return 0;
      }
    }
    if (command === "operations") { output({ data: service.listOperations(LOCAL_CONTEXT, flag(args, "computer")) }); return 0; }
    if (command === "exec" && args[1] === "request") {
      const request: ExecRequest = { argv: parseJsonFlag<string[]>(args, "argv"), idempotencyKey: requiredFlag(args, "idempotency-key") };
      const cwd = flag(args, "cwd"); if (cwd !== undefined) request.cwd = cwd;
      output(service.requestExec(LOCAL_CONTEXT, requiredFlag(args, "computer"), request)); return 0;
    }
    if (command === "install") {
      if (args[1] === "plan") { output(service.installPlan(LOCAL_CONTEXT, requiredFlag(args, "computer"), parseJsonFlag<PackageSpec>(args, "spec"))); return 0; }
      if (args[1] === "apply") { output(service.installApply(LOCAL_CONTEXT, requiredFlag(args, "computer"), requiredFlag(args, "ticket"), requiredFlag(args, "idempotency-key"))); return 0; }
      if (args[1] === "history") { output({ data: service.listOperations(LOCAL_CONTEXT, requiredFlag(args, "computer")).filter((item) => item.kind === "install") }); return 0; }
    }
    if (command === "snapshot") {
      service.getComputer(LOCAL_CONTEXT, requiredFlag(args, "computer"));
      if (args[1] === "list") { output({ data: [], limitations: ["Snapshot provider adapter is not configured in this slice."] }); return 0; }
      if (args[1] === "create") throw new ComputersError("provider_not_configured", "Snapshot provider is not configured", 503);
    }
    if (command === "assignments" && args[1] === "list") { output({ data: service.listComputers(LOCAL_CONTEXT).map((item) => ({ computerId: item.id, principalId: item.ownerPrincipalId, active: true })) }); return 0; }
    if (command === "policies") {
      const computer = service.getComputer(LOCAL_CONTEXT, requiredFlag(args, "computer"));
      if (args[1] === "list") { output(service.storage.getInstallPolicy(LOCAL_CONTEXT.tenantId, computer.id)); return 0; }
      if (args[1] === "set") { output(service.createInstallPolicy(LOCAL_CONTEXT, computer.id, parseJsonFlag<InstallPolicyRule[]>(args, "rules"))); return 0; }
    }
    if (command === "profiles" && args[1] === "list") { output({ data: service.listProfiles(LOCAL_CONTEXT) }); return 0; }
    if (command === "profiles" && args[1] === "create") { output(service.createProfile(LOCAL_CONTEXT, { id: requiredFlag(args, "id"), name: requiredFlag(args, "name"), document: parseJsonFlag(args, "document") })); return 0; }
    if (command === "grants") {
      if (args[1] === "list") { output({ data: service.listComputerGrants(LOCAL_CONTEXT) }); return 0; }
      if (args[1] === "create") {
        output(service.createComputerGrant(LOCAL_CONTEXT, {
          principalId: requiredFlag(args, "principal"), ownerPrincipalId: requiredFlag(args, "owner"),
          parentComputerId: requiredFlag(args, "parent"), allowedProviders: parseJsonFlag(args, "providers"),
          allowedChildOwnerPrincipalIds: parseJsonFlag(args, "child-owners"), allowedRegions: parseJsonFlag(args, "regions"),
          allowedProfileIds: parseJsonFlag(args, "profiles"), maxStorageGiB: Number(requiredFlag(args, "max-storage-gib")),
          maxUptimeSeconds: Number(requiredFlag(args, "max-uptime-seconds")), maxBudgetMicros: Number(requiredFlag(args, "max-budget-micros")),
          limit: Number(requiredFlag(args, "limit")),
        })); return 0;
      }
    }
    if (command === "provider" && args[1] === "readiness") { output({ data: await service.providerReadiness(LOCAL_CONTEXT) }); return 0; }
    throw new ComputersError("unsupported_operation", "Unsupported command", 400);
  } finally { storage.close(); }
}

export async function runCliMain(): Promise<void> {
  try { process.exitCode = await runCli(); }
  catch (error) {
    const failure = error instanceof ComputersError ? error : new ComputersError("storage_error", "Internal error", 500);
    process.stderr.write(`${JSON.stringify({ error: { code: failure.code, message: failure.message } })}\n`);
    process.exitCode = failure.status >= 500 ? 1 : 2;
  }
}
