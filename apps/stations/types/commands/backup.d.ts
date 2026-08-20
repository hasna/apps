import type { SetupResult } from "../types.js";
export declare const STATIONS_BACKUP_BUCKET_ENV = "HASNA_STATIONS_S3_BUCKET";
export declare const STATIONS_BACKUP_BUCKET_FALLBACK_ENV = "STATIONS_S3_BUCKET";
export declare const STATIONS_BACKUP_PREFIX_ENV = "HASNA_STATIONS_S3_PREFIX";
export declare const STATIONS_BACKUP_PREFIX_FALLBACK_ENV = "STATIONS_S3_PREFIX";
export declare const DEFAULT_BACKUP_PREFIX = "stations";
export interface BackupTarget {
    bucket: string;
    prefix: string;
    bucketSource: "argument" | typeof STATIONS_BACKUP_BUCKET_ENV | typeof STATIONS_BACKUP_BUCKET_FALLBACK_ENV;
    prefixSource: "argument" | typeof STATIONS_BACKUP_PREFIX_ENV | typeof STATIONS_BACKUP_PREFIX_FALLBACK_ENV | "default";
}
export declare function resolveBackupTarget(options?: {
    bucket?: string;
    prefix?: string;
}): BackupTarget;
export declare function buildBackupPlan(bucket?: string, prefix?: string): SetupResult;
export declare function runBackup(bucket?: string, prefix?: string, options?: {
    apply?: boolean;
    yes?: boolean;
}): SetupResult;
