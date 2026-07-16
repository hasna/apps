import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthorizationContext, Computer, Operation } from "./contracts";
import { ComputersError } from "./contracts";
import { createLocalProviderPortsFromConfigFile, type LocalVmProfile } from "./local";
import { ComputersService } from "./service";
import { makeId, SQLiteStorage } from "./storage";
import { OperationWorker } from "./worker";

const CANARY_CONTEXT: AuthorizationContext = { tenantId: "tenant_local_canary", principalId: "principal_local_canary_admin", scopes: ["computers:admin"], authMethod: "loopback_dev" };

function requireSucceeded(storage: SQLiteStorage, operation: Operation, phase: string): Operation {
  const current = storage.getOperation(operation.tenantId, operation.id);
  if (current?.status !== "succeeded") throw new ComputersError("provider_outcome_unknown", `Canary ${phase} operation did not succeed durably`, 503);
  return current;
}

function durableCleanupOperation(storage: SQLiteStorage, computer: Computer, kind: "quarantine" | "delete", suffix: string): Operation {
  const now = new Date().toISOString();
  const operation: Operation = {
    id: makeId("opn"), tenantId: computer.tenantId, computerId: computer.id, kind, status: "pending",
    policyGeneration: computer.policyGeneration, idempotencyKey: `canary-cleanup-${kind}-${suffix}`,
    request: { reason: "canary_failure" }, fence: 0, priorComputerStatus: computer.status,
    desiredComputerStatus: kind === "delete" ? "deleted" : "quarantined", createdAt: now, updatedAt: now,
  };
  return storage.createOperation(operation, {
    actorPrincipalId: CANARY_CONTEXT.principalId, action: `computer.${kind}.requested`,
    data: { operationId: operation.id, canaryCleanup: true }, computerId: computer.id,
  }).value;
}

export async function cleanupLocalCanary(storage: SQLiteStorage, service: ComputersService, worker: OperationWorker,
  computer: Computer, suffix: string): Promise<{ deleted: boolean; retainedHome?: string }> {
  let current = storage.getComputer(computer.tenantId, computer.id) ?? computer;
  const active = storage.listOperations(current.tenantId, current.id).find((operation) =>
    ["create", "start", "stop", "quarantine", "delete", "restore"].includes(operation.kind)
      && ["pending", "accepted", "running", "unknown"].includes(operation.status));
  if (active !== undefined) {
    let reconciled = storage.getOperation(active.tenantId, active.id);
    for (let pass = 0; pass < 3 && reconciled !== undefined && ["pending", "accepted", "running", "unknown"].includes(reconciled.status); pass += 1) {
      await worker.runTenant(current.tenantId); reconciled = storage.getOperation(active.tenantId, active.id);
    }
    if (reconciled === undefined || ["pending", "accepted", "running", "unknown"].includes(reconciled.status)) return { deleted: false };
    current = storage.getComputer(current.tenantId, current.id) ?? current;
  }
  if (current.status !== "deleted") {
    let restrictive: Operation | undefined;
    if (current.status === "running" || current.status === "stopped") {
      restrictive = service.requestLifecycle(CANARY_CONTEXT, current.id, "quarantine", `canary-cleanup-quarantine-${suffix}`);
    } else if (current.status !== "quarantined" && current.status !== "error") {
      restrictive = durableCleanupOperation(storage, current, "quarantine", suffix);
    }
    if (restrictive !== undefined) {
      await worker.runTenant(current.tenantId);
      if (storage.getOperation(current.tenantId, restrictive.id)?.status !== "succeeded") return { deleted: false };
    }
    current = storage.getComputer(current.tenantId, current.id) ?? current;
    const deletion = current.status === "stopped" || current.status === "quarantined" || current.status === "error"
      ? service.requestLifecycle(CANARY_CONTEXT, current.id, "delete", `canary-cleanup-delete-${suffix}`)
      : durableCleanupOperation(storage, current, "delete", suffix);
    await worker.runTenant(current.tenantId);
    if (storage.getOperation(current.tenantId, deletion.id)?.status !== "succeeded") return { deleted: false };
  }
  const deleted = storage.getComputer(computer.tenantId, computer.id)?.status === "deleted";
  const bindingReleased = storage.getProviderBinding(computer.tenantId, computer.id)?.state === "released";
  const home = storage.listComputerVolumes(computer.tenantId, computer.id).find((volume) => volume.kind === "home");
  return { deleted: deleted && bindingReleased && home?.state === "detached" && home.providerRef !== undefined, ...(home?.providerRef === undefined ? {} : { retainedHome: home.providerRef }) };
}

export async function runLocalMacCanary(configFile: string, databaseFile: string, confirmation: string): Promise<Record<string, unknown>> {
  if (confirmation !== "LIVE_LOCAL_VM_CANARY") throw new ComputersError("invalid_request", "Live local VM canary confirmation is required", 400);
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new ComputersError("provider_not_configured", "Live local VM canary requires Apple Silicon macOS", 503);
  const configPath = resolve(configFile); if (statSync(configPath).size > 64 * 1024) throw new ComputersError("invalid_request", "Local controller configuration is too large", 400);
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as { vm?: { profile?: Partial<LocalVmProfile> } }; const profileId = raw.vm?.profile?.id;
  if (typeof profileId !== "string") throw new ComputersError("invalid_request", "Local VM profile is missing", 400);
  const databasePath = resolve(databaseFile); mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const providers = createLocalProviderPortsFromConfigFile(configPath); const readiness = await providers.local_vm.readiness();
  if (!readiness.ready || readiness.confinementClass !== "unverified_vm") throw new ComputersError("provider_not_configured", "Stock-Lima canary prerequisites are unavailable", 503);
  const storage = new SQLiteStorage(databasePath); storage.migrate(); const service = new ComputersService(storage, { providers }); const worker = new OperationWorker(storage, providers);
  const profile = raw.vm?.profile as LocalVmProfile;
  service.createProfile(CANARY_CONTEXT, { id: profile.id, name: "Local canary VM", document: {
    provider: "local_vm", cpus: profile.cpus, memoryGiB: profile.memoryGiB, rootDiskGiB: profile.rootDiskGiB,
    homeDiskGiB: profile.homeDiskGiB, imageLocation: profile.imageLocation, imageDigest: profile.imageDigest,
  } });
  let computer: Computer | undefined; let suffix = "uncreated";
  try {
    suffix = Date.now().toString(36); computer = service.createComputer(CANARY_CONTEXT, { id: `cmp_canary_${suffix}`, slug: `canary-${suffix}`, provider: "local_vm",
      ownerPrincipalId: `principal_canary_${suffix}`, profileId, idempotencyKey: `canary-create-${suffix}` });
    const create = storage.listOperations(CANARY_CONTEXT.tenantId, computer.id)[0];
    if (create === undefined) throw new ComputersError("storage_error", "Canary create operation is missing", 500);
    await worker.runTenant(CANARY_CONTEXT.tenantId); requireSucceeded(storage, create, "create");
    if (storage.getComputer(CANARY_CONTEXT.tenantId, computer.id)?.status !== "stopped") throw new ComputersError("provider_outcome_unknown", "Canary VM creation did not reach stopped", 503);
    storage.acquireHomeLease(CANARY_CONTEXT.tenantId, computer.id, computer.ownerPrincipalId, "principal_local_canary_controller", 900, 0);
    const start = service.requestLifecycle(CANARY_CONTEXT, computer.id, "start", `canary-start-${suffix}`); await worker.runTenant(CANARY_CONTEXT.tenantId); requireSucceeded(storage, start, "start");
    const assurance = storage.getProviderAssurance(CANARY_CONTEXT.tenantId, computer.id);
    if (storage.getComputer(CANARY_CONTEXT.tenantId, computer.id)?.status !== "running" || assurance?.confinementClass !== "unverified_vm"
      || storage.getResidentBinding(CANARY_CONTEXT.tenantId, computer.id) !== undefined) throw new ComputersError("provider_outcome_unknown", "Canary did not preserve fail-closed unverified VM authority", 503);
    const stop = service.requestLifecycle(CANARY_CONTEXT, computer.id, "stop", `canary-stop-${suffix}`); await worker.runTenant(CANARY_CONTEXT.tenantId); requireSucceeded(storage, stop, "stop");
    if (storage.getComputer(CANARY_CONTEXT.tenantId, computer.id)?.status !== "stopped") throw new ComputersError("provider_outcome_unknown", "Canary stop was not durably observed", 503);
    const deletion = service.requestLifecycle(CANARY_CONTEXT, computer.id, "delete", `canary-delete-${suffix}`); await worker.runTenant(CANARY_CONTEXT.tenantId);
    const deleted = requireSucceeded(storage, deletion, "delete");
    if (deleted.result?.instanceAbsent !== true || deleted.result.retainedHomeConfirmed !== true
      || storage.getComputer(CANARY_CONTEXT.tenantId, computer.id)?.status !== "deleted"
      || storage.getProviderBinding(CANARY_CONTEXT.tenantId, computer.id)?.state !== "released") {
      throw new ComputersError("provider_outcome_unknown", "Canary deletion, instance absence, or retained disk was not durably proven", 503);
    }
    const home = storage.listComputerVolumes(CANARY_CONTEXT.tenantId, computer.id).find((volume) => volume.kind === "home");
    if (home?.state !== "detached" || home.providerRef === undefined) throw new ComputersError("provider_outcome_unknown", "Canary retained disk was not recorded", 503);
    return { passed: true, computerId: computer.id, assurance: "unverified_vm", retainedHome: home.providerRef,
      limitations: ["Stock Lima remains unverified; the raw retained disk is not claimed formatted, mounted, or usable as durable home."] };
  } catch (error) {
    if (computer === undefined) throw error;
    const cleanup = await cleanupLocalCanary(storage, service, worker, computer, suffix);
    if (!cleanup.deleted) throw new ComputersError("provider_outcome_unknown", `Canary cleanup is not durably proven for ${computer.id}`, 503);
    const cause = error instanceof ComputersError ? error.message : "Canary lifecycle failed";
    throw new ComputersError("provider_not_configured", `${cause}; audited cleanup deleted the VM and retained raw disk ${cleanup.retainedHome ?? "unknown"}`, 503);
  } finally { storage.close(); }
}
