/**
 * Throw when a retired storage-mode variable is set. Naming the retired var
 * and the supported switches makes the error actionable without accepting the
 * value. Safe to call from any entry (client transport resolution, storage
 * status, server backend resolution) — it is a no-op when no legacy key is
 * set.
 */
export declare function assertNoLegacyStorageMode(env?: NodeJS.ProcessEnv): void;
