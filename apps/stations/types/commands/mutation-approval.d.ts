export declare const MUTATION_APPROVAL_FLAG_ENV = "HASNA_STATIONS_ALLOW_MUTATIONS";
export declare const LEGACY_MUTATION_APPROVAL_FLAG_ENV = "HASNA_STATIONS_MUTATION_APPROVAL";
export declare const MUTATION_APPROVAL_TOKEN_ENV = "HASNA_STATIONS_MUTATION_TOKEN";
export declare const MUTATION_APPROVAL_CALLER_ENV = "HASNA_STATIONS_MUTATION_CALLER_ID";
export declare const MUTATION_APPROVAL_RUN_ENV = "HASNA_STATIONS_MUTATION_RUN_ID";
export declare const MUTATION_APPROVAL_REPLAY_PATH_ENV = "HASNA_STATIONS_MUTATION_REPLAY_PATH";
type Env = Record<string, string | undefined>;
export interface MutationApprovalScope {
    surface: string;
    operation: string;
    machineId?: string;
    resourceId?: string;
    callerId?: string;
    runId?: string;
    transport?: string;
    args?: unknown;
    argsSha256?: string;
}
export interface MutationApprovalOptions extends MutationApprovalScope {
    approvalToken?: string;
    env?: Env;
    now?: number | Date;
}
export interface SdkMutationApprovalOptions {
    approvalToken?: string;
    trustedLocalMutation?: TrustedSdkMutationApproval;
    callerId?: string;
    runId?: string;
}
export type TrustedSdkMutationApproval = Readonly<{
    __trustedSdkMutationApproval?: never;
}>;
export interface MutationApprovalClaims extends MutationApprovalScope {
    version: 1;
    issuedAt: number;
    expiresAt: number;
    nonce?: string;
    args_sha256?: string;
}
export interface CreateMutationApprovalTokenOptions {
    env?: Env;
    secret?: string;
    now?: number | Date;
    ttlMs?: number;
    nonce?: string;
}
export interface MutationApprovalDecision {
    approved: boolean;
    reason?: string;
    claims?: MutationApprovalClaims;
}
export declare function createTrustedSdkMutationApproval(): TrustedSdkMutationApproval;
export declare function canonicalMutationArgs(value: unknown): string;
export declare function mutationArgsSha256(value: unknown): string;
export declare function mutationPlanDigest(plan: unknown): string;
export declare function attachMutationPlanDigest<T extends object>(plan: T): T & {
    planDigest: string;
};
export declare function assertMutationPlanDigest(plan: unknown, expectedPlanDigest?: string): void;
export declare function createMutationApprovalToken(scope: MutationApprovalScope, options?: CreateMutationApprovalTokenOptions): string;
export declare function verifyMutationApprovalToken(options: MutationApprovalOptions): MutationApprovalDecision;
export declare function isMutationApproved(options?: Partial<MutationApprovalOptions>): boolean;
export declare function assertMutationApproved(options: MutationApprovalOptions): void;
export declare function assertSdkMutationApproved(scope: Omit<MutationApprovalScope, "surface" | "transport" | "callerId" | "runId">, options?: SdkMutationApprovalOptions): void;
export {};
