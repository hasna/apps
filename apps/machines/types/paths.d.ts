export declare function getDataDir(): string;
export declare function getDbPath(): string;
export declare function getManifestPath(): string;
/**
 * Resolve one exact manifest authority for candidate operations.
 * An explicit CLI path may not silently override a different environment path.
 */
export declare function resolveExactManifestPath(explicitPath?: string, env?: NodeJS.ProcessEnv): string;
export declare function getNotificationsPath(): string;
export declare function getFreezePath(): string;
export declare function getRolloutRecordsPath(): string;
export declare function getRosterConfigPath(): string;
export declare function getRosterRecordsPath(): string;
export declare function getRosterHeartbeatPath(): string;
export declare function getClipboardKeyPath(): string;
export declare function getClipboardHistoryPath(): string;
export declare function ensureParentDir(filePath: string): void;
export declare function ensureDataDir(): string;
/**
 * The per-run flip ledger (P1-C). JSONL, one entry per machine per flip run.
 * Every row is value-free: machine, app, ts, result, source-of-value, sha256,
 * provenance-gate verdict.
 */
export declare function getFlipLedgerPath(): string;
