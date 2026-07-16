import { ComputersError, type HomeLeaseCapability, type Operation, type ProviderKind, type ProviderOutcome } from "./contracts";
import { inspectProviderOutcome, type ProviderMalformedOutcome, type ProviderOperationRequest, type ProviderPort } from "./providers";
import type { StoragePort } from "./storage";

interface ProviderOutcomeResolution {
  outcome: ProviderOutcome;
  malformed?: ProviderMalformedOutcome;
}

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
      let policyFenced = false;
      try {
        this.#storage.assertOperationPolicyCurrent(tenantId, operation.id);
      } catch (error) {
        const failure = error instanceof ComputersError ? error : new ComputersError("storage_error", "Worker operation failed", 500);
        if (failure.code === "policy_generation_mismatch") {
          if (this.#storage.getProviderAttempt(tenantId, operation.id) === undefined) {
            this.#storage.failOperationPolicyFence(tenantId, operation.id);
            handled += 1;
            continue;
          }
          policyFenced = true;
        } else {
          this.#storage.updateOperation(tenantId, operation.id, "failed", undefined, failure.code);
          handled += 1;
          continue;
        }
      }

      const provider = this.#providers[computer.provider];
      let claim;
      try {
        claim = this.#storage.claimProviderAttempt(operation);
      } catch (error) {
        if (error instanceof ComputersError && error.code === "policy_generation_mismatch") {
          this.#storage.failOperationPolicyFence(tenantId, operation.id);
          handled += 1;
          continue;
        }
        if (error instanceof ComputersError && ["conflict", "not_found", "stale_fence"].includes(error.code)) continue;
        throw error;
      }
      if (claim.mode === "busy") continue;
      policyFenced ||= claim.policyFenced === true;
      const attempt = claim.attempt;
      const awsStrictContinuityRequired = computer.provider === "aws_ec2"
        && this.#storage.getProviderAssurance(tenantId, operation.computerId)?.confinementClass === "strict_vm";
      const authorityFenced = claim.mode === "reconcile" && computer.status === "quarantined"
        && ["create", "start", "restore"].includes(operation.kind);
      const abortController = new AbortController();
      const providerOperation = this.#bindCurrentProfile(operation, computer.provider);
      const request: ProviderOperationRequest = {
        computer, operation: providerOperation, attempt,
        execution: {
          ownerGeneration: attempt.executionOwnerGeneration,
          signal: abortController.signal,
          assertCurrent: () => this.#storage.assertProviderAttemptOwnership(attempt),
        },
      };
      let homeLease: HomeLeaseCapability | undefined;
      let homeFenced = false;
      if (operation.kind === "start" || operation.kind === "restore") {
        homeLease = this.#storage.getOperationHomeLease(tenantId, operation.id);
        if (homeLease === undefined) {
          homeFenced = true;
        } else if (homeLease.tenantId !== operation.tenantId || homeLease.computerId !== operation.computerId) {
          homeFenced = true;
        } else {
          try { this.#storage.assertHomeLeaseCapability(homeLease); }
          catch { homeFenced = true; }
        }
        if (homeFenced && claim.mode === "perform") {
          this.#storage.completeProviderOperation(operation, attempt, { kind: "definite_failure", code: "stale_fence", message: "Home lease capability does not match the operation" });
          handled += 1;
          continue;
        }
        if (!homeFenced && homeLease !== undefined) request.homeLease = homeLease;
      }

      let outcome: ProviderOutcome;
      let malformedOutcome: ProviderMalformedOutcome | undefined;
      let ownershipLost = false;
      const heartbeat = setInterval(() => {
        try { this.#storage.renewProviderAttemptOwnership(attempt); }
        catch { ownershipLost = true; abortController.abort(); }
      }, 60_000);
      try {
        this.#storage.renewProviderAttemptOwnership(attempt);
        request.execution.assertCurrent();
        const resolution = this.#resolveProviderResult(claim.mode === "perform"
          ? await this.#perform(provider, request, homeLease)
          : await provider.reconcile(request), attempt);
        outcome = resolution.outcome;
        malformedOutcome = resolution.malformed;
        request.execution.assertCurrent();
        if (malformedOutcome === undefined && claim.mode === "reconcile" && (policyFenced || homeFenced || authorityFenced)) {
          const fenced = await this.#resolveFencedOutcome(provider, request, outcome, policyFenced ? "policy_generation_mismatch" : "stale_fence");
          outcome = fenced.outcome;
          malformedOutcome = fenced.malformed;
        } else if (malformedOutcome === undefined && awsStrictContinuityRequired && ["create", "start", "restore"].includes(operation.kind)
          && (outcome.kind === "unknown" || (outcome.kind === "success" && !this.#preservesStrictAssurance(outcome)))) {
          const observed = outcome;
          try {
            const compensation = this.#resolveProviderResult(await provider.quarantine({ ...request, compensatingQuarantine: true }), attempt);
            if (compensation.malformed !== undefined) {
              const resource = compensation.malformed.resource ?? observed.resource;
              malformedOutcome = { ...compensation.malformed, ...(resource === undefined ? {} : { resource }) };
              outcome = { kind: "unknown", providerOperationId: malformedOutcome.providerOperationId,
                ...(resource === undefined ? {} : { resource }), message: malformedOutcome.message };
            } else {
              const resource = compensation.outcome.resource ?? observed.resource;
              const quarantineObserved = this.#observesLifecycle(compensation.outcome, "quarantined");
              outcome = {
                kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
                ...(resource === undefined ? {} : { resource }), message: quarantineObserved
                  ? "Strict provider proof was lost; the external runtime was quarantined"
                  : "Strict provider proof was lost and quarantine is indeterminate",
              };
            }
          } catch {
            outcome = { kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
              ...(observed.resource === undefined ? {} : { resource: observed.resource }), message: "Strict-provider compensation is indeterminate" };
          }
        }
      } catch (error) {
        malformedOutcome = undefined;
        if (error instanceof ComputersError && error.code === "conflict") {
          ownershipLost = true;
          abortController.abort();
          outcome = { kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey, message: "Provider execution ownership was lost" };
        } else {
          outcome = { kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey, message: "Provider outcome is indeterminate" };
        }
      } finally { clearInterval(heartbeat); }
      if (ownershipLost || abortController.signal.aborted) {
        this.#storage.recordProviderOwnershipLost(attempt, outcome.resource);
        handled += 1;
        continue;
      }
      try {
        if (malformedOutcome !== undefined) this.#storage.recordProviderMalformed(attempt, malformedOutcome);
        else if (outcome.kind === "unknown") this.#storage.recordProviderUnknown(attempt, outcome);
        else {
          try { this.#storage.completeProviderOperation(operation, attempt, outcome); }
          catch (error) {
            if (outcome.kind === "success" && error instanceof ComputersError && error.code === "invalid_request"
              && ["Provider returned an invalid observed lifecycle", "Provider returned an incompatible observed lifecycle"].includes(error.message)) {
              this.#storage.recordProviderUnknown(attempt, {
                kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
                resource: outcome.resource, message: "Provider returned an invalid observed lifecycle",
              });
            } else if (outcome.kind === "success" && error instanceof ComputersError && ["policy_generation_mismatch", "stale_fence"].includes(error.code)) {
              this.#storage.recordProviderUnknown(attempt, {
                kind: "unknown", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
                resource: outcome.resource, message: "Provider succeeded after the operation was fenced; reconciliation and compensation are required",
              });
            } else throw error;
          }
        }
      } catch (error) {
        if (error instanceof ComputersError && error.code === "conflict") {
          abortController.abort();
          this.#storage.recordProviderOwnershipLost(attempt, outcome.resource);
          handled += 1;
          continue;
        }
        throw error;
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

  async #resolveFencedOutcome(provider: ProviderPort, request: ProviderOperationRequest, outcome: ProviderOutcome,
    fenceCode: "policy_generation_mismatch" | "stale_fence"): Promise<ProviderOutcomeResolution> {
    if (outcome.kind === "unknown") return { outcome };
    if (outcome.kind === "definite_failure") return { outcome: { ...outcome, code: fenceCode } };
    if (["stop", "quarantine", "delete"].includes(request.operation.kind)) {
      return { outcome: { kind: "definite_failure", code: fenceCode, message: "Fenced operation reconciled to a restrictive external state", resource: outcome.resource } };
    }
    const compensation = this.#resolveProviderResult(await provider.quarantine({ ...request, compensatingQuarantine: true }), request.attempt);
    if (compensation.malformed !== undefined) {
      const resource = compensation.malformed.resource ?? outcome.resource;
      return {
        outcome: { kind: "unknown", providerOperationId: compensation.malformed.providerOperationId,
          ...(resource === undefined ? {} : { resource }), message: compensation.malformed.message },
        malformed: { ...compensation.malformed, ...(resource === undefined ? {} : { resource }) },
      };
    }
    if (this.#observesLifecycle(compensation.outcome, "quarantined")) {
      return { outcome: { kind: "definite_failure", code: fenceCode, message: "Fenced external state was quarantined", resource: compensation.outcome.resource ?? outcome.resource } };
    }
    return { outcome: {
      kind: "unknown", providerOperationId: request.attempt.providerOperationId ?? request.attempt.providerIdempotencyKey,
      resource: compensation.outcome.resource ?? outcome.resource, message: "Fenced external state could not be proven quarantined",
    } };
  }

  #resolveProviderResult(value: unknown, attempt: ProviderOperationRequest["attempt"]): ProviderOutcomeResolution {
    const inspection = inspectProviderOutcome(value);
    if (inspection.kind === "valid") return { outcome: inspection.outcome };
    const malformed: ProviderMalformedOutcome = {
      kind: "malformed", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
      message: inspection.message, ...(inspection.resource === undefined ? {} : { resource: inspection.resource }),
    };
    return {
      malformed,
      outcome: { kind: "unknown", providerOperationId: malformed.providerOperationId,
        ...(malformed.resource === undefined ? {} : { resource: malformed.resource }), message: malformed.message },
    };
  }

  #observesLifecycle(outcome: ProviderOutcome, lifecycle: string): boolean {
    return outcome.kind === "success" && Object.hasOwn(outcome.result, "lifecycle") && outcome.result.lifecycle === lifecycle;
  }

  #preservesStrictAssurance(outcome: Extract<ProviderOutcome, { kind: "success" }>): boolean {
    const assurance = outcome.result.assurance;
    return typeof assurance === "object" && assurance !== null && !Array.isArray(assurance)
      && (assurance as Record<string, unknown>).confinementClass === "strict_vm";
  }

  #bindCurrentProfile(operation: Operation, provider: ProviderKind): Operation {
    if (provider !== "local_machine" && provider !== "local_vm") return operation;
    const create = operation.kind === "create" ? operation : this.#storage.listOperations(operation.tenantId, operation.computerId).find((item) =>
      item.kind === "create" && typeof item.request.profileId === "string");
    const profileId = create?.request.profileId;
    if (typeof profileId !== "string") return operation;
    const profile = this.#storage.getProfile(operation.tenantId, profileId);
    if (profile === undefined) {
      const snapshot = create?.request.profile;
      if ((profileId === "profile_default" || profileId === "profile_adopted") && typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot)) {
        const bound = snapshot as Record<string, unknown>;
        if (bound.id === profileId && bound.generation === 1 && typeof bound.digest === "string" && typeof bound.document === "object" && bound.document !== null) {
          return { ...operation, request: { ...operation.request, profileId, profile: structuredClone(bound) } };
        }
      }
      return { ...operation, request: { ...operation.request, profileId } };
    }
    return { ...operation, request: { ...operation.request, profileId,
      profile: { id: profile.id, generation: profile.generation, digest: profile.digest, document: profile.document } } };
  }
}
