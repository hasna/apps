import { type CredentialChainOptions } from "@hasna/contracts/client";
import { type IntakeBinding, type IntakeRequest, type IntakeReceipt } from "./protocol.js";
export * from "./protocol.js";
/** HTTP only. No filesystem spool acknowledgment or destination auto-adoption. */
export declare function createIntakeClient(options: {
    binding: IntakeBinding;
    tenantId: string;
    env?: Record<string, string | undefined>;
    credentials?: CredentialChainOptions;
}): Readonly<{
    /** Canonical authority captured by this exact transport; contains no credential. */
    baseUrl: string;
    capability(): Promise<void>;
    accept(raw: IntakeRequest, signal?: AbortSignal): Promise<IntakeReceipt>;
    receipt(raw: IntakeRequest, signal?: AbortSignal): Promise<IntakeReceipt>;
}>;
