import { type CredentialChainOptions } from "@hasna/contracts/client";
import { type IntakeBinding, type IntakeRequest, type IntakeReceipt } from "./protocol.js";
export * from "./protocol.js";
/** HTTP only. No filesystem spool acknowledgment or destination auto-adoption. */
export declare function createIntakeClient(options: {
    binding: IntakeBinding;
    tenantId: string;
    env?: Record<string, string | undefined>;
    credentials?: CredentialChainOptions;
}): {
    capability(): Promise<void>;
    accept(raw: IntakeRequest, signal?: AbortSignal): Promise<IntakeReceipt>;
    receipt(raw: IntakeRequest, signal?: AbortSignal): Promise<IntakeReceipt>;
};
