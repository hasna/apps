/** Hard Stage-A aggregate limits. Callers cannot raise these ceilings. */
export declare const MAX_INGEST_BODY_BYTES = 8388608;
export declare const MAX_INGEST_BATCH_ITEMS = 4096;
export declare const MAX_JSON_STRUCTURAL_TOKENS = 65536;
export declare const MAX_JSON_PROPERTIES = 32768;
export declare const MAX_JSON_DEPTH = 64;
export declare const MAX_JSON_OBJECT_PROPERTIES = 256;
export declare const MAX_JSON_NODES = 4096;
export declare const MAX_JSON_KEY_BYTES = 16384;
export declare const MAX_JSON_STRING_BYTES = 8388608;
export interface BoundedDataGraphOptions {
    readonly label?: string;
    readonly maxBytes?: number;
}
/**
 * Clone an untrusted already-materialized data graph without invoking getters,
 * proxy traps, iterators, toJSON hooks, or custom prototypes. The clone is
 * bounded before callers enumerate it and contains JSON-compatible data only.
 */
export declare function cloneBoundedDataGraph<T>(value: T, options?: BoundedDataGraphOptions): T;
export declare function hardLimit(requested: number | undefined, fallback: number, maximum: number, label: string): number;
/**
 * Pre-scan bounded JSON/JSONL before JSON.parse materializes its object graph.
 * The scanner is deliberately syntax-agnostic; JSON.parse remains authoritative
 * after these hard aggregate ceilings have been enforced.
 */
export declare function assertBoundedJsonText(text: string, maxArrayItems?: number, maxTopLevelValues?: number): void;
/** Parse persisted JSON only after byte/shape pre-scan, then data-clone it. */
export declare function parseBoundedJsonData<T>(text: string, label?: string, maxArrayItems?: number, maxTopLevelValues?: number): T;
