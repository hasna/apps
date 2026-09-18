/**
 * Pure output-efficiency primitives for Hasna CLI and MCP adapters.
 *
 * This module performs no I/O and has no dependency on Commander, MCP,
 * credentials, URLs, environment variables, clocks, or hosted transports.
 * Callers provide already-authorized records and decide where bytes are sent.
 */
export declare const OUTPUT_PAGE_CONTRACT_VERSION: 1;
export type OutputContractErrorCode = "OUTPUT_INVALID_RECORD" | "OUTPUT_INVALID_FIELD" | "OUTPUT_UNKNOWN_FIELD" | "OUTPUT_REQUIRED_FIELD_MISSING" | "OUTPUT_ACCESSOR_PROPERTY" | "OUTPUT_INVALID_PAGE" | "OUTPUT_UNSUPPORTED_VALUE" | "OUTPUT_NON_FINITE_NUMBER" | "OUTPUT_CIRCULAR_REFERENCE" | "OUTPUT_INVALID_BUDGET" | "OUTPUT_CONTINUATION_REQUIRED" | "OUTPUT_ITEM_EXCEEDS_BUDGET" | "OUTPUT_BUDGET_TOO_SMALL";
/** Stable, value-redacting error raised by the pure output contract. */
export declare class OutputContractError extends TypeError {
    readonly code: OutputContractErrorCode;
    readonly path?: string;
    constructor(code: OutputContractErrorCode, message: string, path?: string);
}
/** Cross-package/realm-safe guard for adapter error mapping. */
export declare function isOutputContractError(value: unknown): value is OutputContractError;
export type UnknownFieldPolicy = "error" | "omit";
export interface ProjectionOptions {
    /** Fields that are always emitted before caller-selected fields. */
    requiredFields?: readonly string[];
    /** Missing selected fields refuse by default; `omit` is an explicit relaxation. */
    unknownFields?: UnknownFieldPolicy;
    /** Undefined optional values are omitted by default because JSON cannot represent them. */
    omitUndefined?: boolean;
}
/**
 * Select exact top-level fields without mutating the source record.
 *
 * Accessors and exotic objects refuse rather than executing caller code during
 * projection. Required fields always refuse when absent or undefined.
 */
export declare function projectRecord(record: unknown, fields: readonly string[], options?: ProjectionOptions): Record<string, unknown>;
export declare function projectRecords(records: readonly unknown[], fields: readonly string[], options?: ProjectionOptions): Array<Record<string, unknown>>;
export type OutputCursor = string | number | null;
export type OutputCursorSemantics = "offset" | "opaque" | "whole-query";
export type OutputSortDirection = "asc" | "desc";
declare const OUTPUT_PAGE_BRAND: unique symbol;
export interface OutputSort {
    field: string;
    direction: OutputSortDirection;
}
export interface OutputPageMeta {
    contract_version: typeof OUTPUT_PAGE_CONTRACT_VERSION;
    count: number;
    total: number | null;
    limit: number;
    cursor: OutputCursor;
    next_cursor: OutputCursor;
    cursor_semantics: OutputCursorSemantics;
    has_more: boolean;
    /** True only when this envelope contains the entire requested population. */
    complete: boolean;
    /** True when this representation omitted data for a named reason. */
    truncated: boolean;
    truncation_reasons?: readonly string[];
    detail?: string;
    fields?: readonly string[];
    sort?: OutputSort;
    byte_length?: number;
    max_bytes?: number;
}
export interface OutputPageEnvelope<T> {
    readonly items: readonly T[];
    readonly _meta: Readonly<OutputPageMeta>;
    readonly [OUTPUT_PAGE_BRAND]: true;
}
export interface CreatePageEnvelopeInput<T> {
    items: readonly T[];
    limit: number;
    cursor?: OutputCursor;
    nextCursor?: OutputCursor;
    /** Numeric cursors are offsets unless `whole-query` is explicit. */
    cursorSemantics?: OutputCursorSemantics;
    hasMore: boolean;
    complete: boolean;
    total?: number | null;
    truncated?: boolean;
    truncationReasons?: readonly string[];
    detail?: string;
    fields?: readonly string[];
    sort?: OutputSort;
    byteLength?: number;
    maxBytes?: number;
}
/** Build and validate a page envelope without inferring completeness. */
export declare function createPageEnvelope<T>(input: CreatePageEnvelopeInput<T>): OutputPageEnvelope<T>;
/**
 * Runtime validation and canonicalization for JavaScript or cross-package page envelopes.
 * The returned value is branded and frozen exactly like `createPageEnvelope` output.
 */
export declare function validatePageEnvelope<T = unknown>(value: unknown): OutputPageEnvelope<T>;
export interface JsonSerializationOptions {
    /** Compact by default; `true` selects a stable two-space representation. */
    pretty?: boolean;
    /** Disabled by default. JSONL helpers always frame records with LF. */
    trailingNewline?: boolean;
}
/** Deterministic strict JSON: sorted record keys, finite numbers, no accessors or toJSON execution. */
export declare function serializeJson(value: unknown, options?: JsonSerializationOptions): string;
/** One compact deterministic JSON value followed by exactly one LF. */
export declare function serializeJsonLine(value: unknown): string;
/** Compact deterministic JSONL. Empty input emits an empty string. */
export declare function serializeJsonLines(values: readonly unknown[]): string;
export interface JsonMeasurement {
    text: string;
    bytes: number;
}
/** Exact UTF-8 wire-byte count, not JavaScript UTF-16 code units. */
export declare function utf8ByteLength(text: string): number;
export declare function measureJson(value: unknown, options?: JsonSerializationOptions): JsonMeasurement;
export declare function measureJsonLines(values: readonly unknown[]): JsonMeasurement;
/**
 * Typed JSONL page framing. The final receipt is mandatory because omitting it
 * would make pagination, completeness, total, and truncation claims unknowable.
 * Structural inputs are revalidated and canonicalized before any item is emitted.
 */
export declare function serializePageJsonLines<T>(envelope: OutputPageEnvelope<T>): string;
export interface FitPageToByteBudgetOptions {
    maxBytes: number;
    /**
     * Opaque cursor for the first omitted item when local byte clipping occurs.
     * Required only for `cursorSemantics="opaque"`; offset cursors are derived.
     */
    nextCursorForIndex?: (firstOmittedIndex: number) => Exclude<OutputCursor, null>;
    serialization?: JsonSerializationOptions;
}
export interface BudgetedPage<T> {
    envelope: OutputPageEnvelope<T>;
    text: string;
    bytes: number;
    max_bytes: number;
    omitted_items: number;
}
/**
 * Fit the largest ordered prefix of a page into an exact serialized UTF-8 budget.
 *
 * Local clipping always clears `complete`, records `byte_budget`, and requires
 * a usable continuation cursor. An item that cannot fit is refused rather than
 * skipped, preserving stable pagination order.
 */
export declare function fitPageToByteBudget<T>(envelope: OutputPageEnvelope<T>, options: FitPageToByteBudgetOptions): BudgetedPage<T>;
export {};
