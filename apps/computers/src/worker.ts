import { ComputersError, type HomeLeaseCapability, type Operation, type ProviderKind, type ProviderOutcome } from "./contracts";
import { validateProviderOutcome, type ProviderOperationRequest, type ProviderPort } from "./providers";
import type { StoragePort } from "./storage";

export class OperationWorker {
  readonly #storage: StoragePort;
  readonly #providers: Record<ProviderKind, ProviderPort>;

  constructor(storage: StoragePort, providers: Record<ProviderKind, ProviderPort>) {
    this.#storage = storage;
    this.#providers = providers;
  }

  async runTenant(tenantId: string): Promise<number> {
    let handled = 0;
    const candidates = this.#storage.listOperations(tenantId).filter((item) => ["pending", "accepted", "running", "unknown"].includes(item.status));
    for (const operation of candidates) {
      const computer = this.#storage.getComputer(tenantId, operation.computerId);
      if (computer === undefined) continue;
      try {
        this.#storage.assertOperationPolicyCurrent(tenantId, operation.id);
      } catch (error) {
        const failure = error instanceof ComputersError ? error : new ComputersError("storage_error", "Worker operation failed", 500);
        if (failure.code === "policy_generation_mismatch") this.#storage.failOperationPolicyFence(tenantId, operation.id);
        else this.#storage.updateOperation(tenantId, operation.id, "failed", undefined, failure.code);
        handled += 1;
        continue;
      }

      const provider = this.#providers[computer.provider];
      const existingAttempt = this.#storage.getProviderAttempt(tenantId, operation.id);
      const attempt = existingAttempt ?? this.#storage.beginProviderAttempt(operation);
      const request: ProviderOperationRequest = { computer, operation, attempt };
      let homeLease: HomeLeaseCapability | undefined;
      if (operation.kind === "start" || operation.kind === "restore") {
        homeLease = this.#storage.getOperationHomeLease(tenantId, operation.id);
        if (homeLease === undefined) {
          this.#storage.completeProviderOperation(operation, attempt, { kind: "definite_failure", code: "stale_fence", message: "A current home lease capability is required" });
          handled += 1;
          continue;
        }
        if (homeLease.tenantId !== operation.tenantId || homeLease.computerId !== operation.computerId) {
          this.#storage.completeProviderOperation(operation, attempt, { kind: "definite_failure", code: "stale_fence", message: "Home lease capability does not match the operation" });
          handled += 1;
          continue;
        }
        try { this.#storage.assertHomeLeaseCapability(homeLease); }
        catch {
          this.#storage.completeProviderOperation(operation, attempt, { kind: "definite_failure", code: "stale_fence", message: "Home lease capability is stale" });
          handled += 1;
          continue;
        }
        request.homeLease = homeLease;
      }

      let outcome: ProviderOutcome;
      try {
        outcome = validateProviderOutcome(existingAttempt === undefined
          ? await this.#perform(provider, request, homeLease)
          : await provider.reconcile(request));
      } catch (error) {
        if (error instanceof ComputersError && error.code === "provider_not_configured") {
          outcome = { kind: "definite_failure", code: error.code, message: error.message };
        } else {
          outcome = { kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey, message: "Provider outcome is indeterminate" };
        }
      }
      if (outcome.kind === "unknown") this.#storage.recordProviderUnknown(attempt, outcome);
      else {
        try { this.#storage.completeProviderOperation(operation, attempt, outcome); }
        catch (error) {
          if (outcome.kind === "success" && error instanceof ComputersError && error.code === "policy_generation_mismatch") {
            this.#storage.recordProviderUnknown(attempt, {
              kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
              resource: outcome.resource, message: "Provider succeeded after the operation was fenced; reconciliation is required",
            });
          } else throw error;
        }
      }
      handled += 1;
    }
    return handled;
  }

  async #perform(provider: ProviderPort, request: ProviderOperationRequest, homeLease?: HomeLeaseCapability): Promise<ProviderOutcome> {
    if (request.operation.kind === "create") return provider.create(request);
    if (request.operation.kind === "start" && homeLease !== undefined) return provider.start({ ...request, homeLease });
    if (request.operation.kind === "stop") return provider.stop(request);
    if (request.operation.kind === "quarantine") return provider.quarantine(request);
    if (request.operation.kind === "delete") return provider.delete(request);
    if (request.operation.kind === "restore" && homeLease !== undefined) return provider.restore({ ...request, homeLease });
    return { kind: "definite_failure", code: "provider_not_configured", message: `Operation ${request.operation.kind} requires a configured resident/provider` };
  }
}
