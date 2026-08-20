import type { MachineManifest } from "./types.js";
export declare const REDACTED_VALUE = "[redacted]";
export declare const PRIVATE_METADATA_ENV = "HASNA_MACHINES_PRIVATE_METADATA";
export declare const PRIVATE_METADATA_FALLBACK_ENV = "MACHINES_PRIVATE_METADATA";
export declare const PRIVATE_OUTPUT_ENV = "HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT";
export declare const PRIVATE_OUTPUT_FALLBACK_ENV = "MACHINES_ALLOW_PRIVATE_OUTPUT";
export declare const PRIVATE_OUTPUT_DENIED_WARNING = "private_output_denied:set HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT=1 to allow private metadata output";
export declare function isSensitiveKey(key: string): boolean;
export declare function isPrivateMetadataEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function isPrivateOutputEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function redactPath(value: string): string;
export declare function redactNetworkValue(value: string): string;
export declare function redactErrorMessage(value: string): string;
export interface IncrementalCredentialRedactor {
    push(value: string): string;
    finish(): string;
}
export declare function createIncrementalCredentialRedactor(): IncrementalCredentialRedactor;
export declare function redactPrivateRef(value: string): string;
export declare function redactIdentifier(value: string): string;
export interface RedactSensitiveValueOptions {
    redactPaths?: boolean;
    redactSecretReferences?: boolean;
}
export declare function redactSensitiveValue(value: unknown, key?: string, options?: RedactSensitiveValueOptions): unknown;
export declare function publicMetadataKeys(metadata: Record<string, unknown> | undefined): string[];
export declare function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown>;
export declare function redactMetadataForTopology(metadata: Record<string, unknown> | undefined): Record<string, unknown>;
export declare function redactManifestForDiagnostics(machine: MachineManifest): Record<string, unknown>;
