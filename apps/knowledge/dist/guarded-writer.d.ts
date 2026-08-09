import { type CreateKnowledgeGuardedManifestOptions, type KnowledgeGuardedBinding, type KnowledgeGuardedBindingStateReadback, type KnowledgeGuardedBounds, type KnowledgeGuardedAdoptionReconciliation, type KnowledgeGuardedAdoptionReceipt, type KnowledgeGuardedAdoptionResult, type KnowledgeGuardedLegacyAdoptionOptions, type KnowledgeGuardedLegacyRollbackOptions, type KnowledgeGuardedLimits, type KnowledgeGuardedManifestReconciliation, type KnowledgeGuardedManifestSubmission, type KnowledgeGuardedReadback, type KnowledgeGuardedReceipt, type KnowledgeGuardedRollbackResult, type KnowledgeGuardedWriteResult, type KnowledgePrivateInputDescriptor, type KnowledgeTerminalReconciliation } from './guarded-write-contract.js';
export interface CreateKnowledgeGuardedWriterOptions {
    binding: KnowledgeGuardedBinding;
    env?: NodeJS.ProcessEnv;
    limits?: Partial<KnowledgeGuardedLimits>;
    /**
     * Fail closed unless every executed descriptor names a pre-created manifest
     * step. Set this for every multi-record or multi-authority workflow.
     */
    require_manifest?: boolean;
}
export interface KnowledgeGuardedWriter {
    readonly binding: KnowledgeGuardedBinding;
    readonly limits: KnowledgeGuardedLimits;
    readonly require_manifest: boolean;
    createManifest(manifest: CreateKnowledgeGuardedManifestOptions, bounds?: KnowledgeGuardedBounds): Promise<KnowledgeGuardedManifestSubmission>;
    reconcileManifest(manifestId: string, bounds?: KnowledgeGuardedBounds): Promise<KnowledgeGuardedManifestReconciliation>;
    execute(descriptor: KnowledgePrivateInputDescriptor): Promise<KnowledgeGuardedWriteResult>;
    reconcile(deterministicKey: string, operationId: string, stepId: string, bounds?: KnowledgeGuardedBounds): Promise<KnowledgeTerminalReconciliation>;
    readback(fullId: string, bounds?: KnowledgeGuardedBounds): Promise<KnowledgeGuardedReadback>;
    readBindingState(fullId: string, bounds?: KnowledgeGuardedBounds): Promise<KnowledgeGuardedBindingStateReadback>;
    adoptLegacy(options: KnowledgeGuardedLegacyAdoptionOptions): Promise<KnowledgeGuardedAdoptionResult>;
    rollbackLegacyAdoption(options: KnowledgeGuardedLegacyRollbackOptions): Promise<KnowledgeGuardedRollbackResult>;
    reconcileAdoption(deterministicKey: string, operationId: string, stepId: string, bounds?: KnowledgeGuardedBounds): Promise<KnowledgeGuardedAdoptionReconciliation>;
}
export declare class KnowledgeGuardedWriteRejectedError extends Error {
    readonly receipt: KnowledgeGuardedReceipt;
    readonly reconciliation: KnowledgeTerminalReconciliation;
    readonly code = "guarded_write_rejected";
    constructor(receipt: KnowledgeGuardedReceipt, reconciliation: KnowledgeTerminalReconciliation);
}
export declare class KnowledgeGuardedOperationConflictError extends Error {
    readonly receipt: KnowledgeGuardedReceipt;
    readonly code = "guarded_operation_conflict";
    constructor(receipt: KnowledgeGuardedReceipt);
}
export declare class KnowledgeGuardedManifestConflictError extends Error {
    readonly manifest: KnowledgeGuardedManifestSubmission['manifest'];
    readonly code = "guarded_manifest_conflict";
    constructor(manifest: KnowledgeGuardedManifestSubmission['manifest']);
}
export declare class KnowledgeGuardedManifestStepRefusedError extends Error {
    readonly deterministic_key: string;
    readonly reason: string;
    readonly code = "guarded_manifest_step_refused";
    constructor(deterministic_key: string, reason: string);
}
export declare class KnowledgeGuardedManifestUncertainError extends Error {
    readonly deterministic_key: string;
    readonly code = "guarded_manifest_terminal_state_unavailable";
    constructor(deterministic_key: string);
}
export declare class KnowledgeGuardedWriteUncertainError extends Error {
    readonly deterministic_key: string;
    readonly code = "guarded_write_terminal_state_unavailable";
    constructor(deterministic_key: string);
}
export declare class KnowledgeGuardedAdoptionRejectedError extends Error {
    readonly receipt: KnowledgeGuardedAdoptionReceipt;
    readonly reconciliation: KnowledgeGuardedAdoptionReconciliation;
    readonly code = "guarded_adoption_rejected";
    constructor(receipt: KnowledgeGuardedAdoptionReceipt, reconciliation: KnowledgeGuardedAdoptionReconciliation);
}
export declare class KnowledgeGuardedAdoptionOperationConflictError extends Error {
    readonly receipt: KnowledgeGuardedAdoptionReceipt | null;
    readonly code = "guarded_adoption_operation_conflict";
    constructor(receipt: KnowledgeGuardedAdoptionReceipt | null);
}
export declare class KnowledgeGuardedAdoptionUncertainError extends Error {
    readonly deterministic_key: string;
    readonly code = "guarded_adoption_terminal_state_unavailable";
    constructor(deterministic_key: string);
}
export declare function createKnowledgeGuardedWriter(options: CreateKnowledgeGuardedWriterOptions): KnowledgeGuardedWriter;
