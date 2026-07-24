import { type KnowledgeRuntimeSurface } from './runtime-role';
export interface PublicInvocationGuardOptions {
    readonly surface?: KnowledgeRuntimeSurface;
    readonly explicitConfigPath?: string;
    readonly requireConfig?: boolean;
}
export declare const MAX_PUBLIC_ARRAY_ITEMS = 4096;
export declare const MAX_PUBLIC_OBJECT_PROPERTIES = 256;
export declare const MAX_PUBLIC_TOTAL_PROPERTIES = 8192;
export declare const MAX_PUBLIC_NODES = 4096;
export declare const MAX_PUBLIC_BYTES = 8388608;
export declare function safePublicProperty(value: object, key: string | symbol, surface?: KnowledgeRuntimeSurface): unknown;
export declare function assertClassifiedSourceReference(sourceRef: unknown, options?: {
    allowStored?: boolean;
    surface?: KnowledgeRuntimeSurface;
}): asserts sourceRef is string;
/** Validate URI-bearing runtime options while preserving bounded opaque state. */
export declare function assertContainedSourceGraph(value: unknown, surface?: KnowledgeRuntimeSurface): void;
/** Strictly traverse manifest/outbox source data before any local mutation. */
export declare function assertContainedSourceDataGraph(value: unknown, surface?: KnowledgeRuntimeSurface): void;
/**
 * Canonical public pre-gate. Ambient hosted intent is checked before any
 * caller value is touched. The bounded classifier then centralizes nested S3,
 * config, path, and supplied-env handling for every preserved public wrapper.
 */
export declare function assertPublicInvocation(values?: readonly unknown[], options?: PublicInvocationGuardOptions): void;
/** Public root auth compatibility is intentionally a zero-read Stage-A stub. */
export declare function denyPublicAuth(): never;
