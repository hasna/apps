/**
 * `@hasna/estate-sync/sdk` — the programmatic surface.
 *
 * Identical exports to the main entrypoint. The subpath exists so consumers
 * that want only the SDK (no accidental CLI surface) have a stable import
 * target, matching the `./sdk` convention in the hasna/apps monorepo.
 */
export * from "../index.js";
