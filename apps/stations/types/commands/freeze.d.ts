import type { FreezeEntry } from "../types.js";
export interface FreezeFile {
    version: 1;
    updatedAt?: string;
    packages: FreezeEntry[];
}
export declare function readFreezeFile(path?: string): FreezeFile;
export declare function writeFreezeFile(file: FreezeFile, path?: string): string;
export declare function addFreeze(entry: FreezeEntry, path?: string): FreezeFile;
export declare function removeFreeze(name: string, path?: string): {
    removed: boolean;
    file: FreezeFile;
};
/** Effective freeze list: freeze.json entries plus manifest-declared entries. */
export declare function listActiveFreezes(options?: {
    freezePath?: string;
    manifestPath?: string;
    now?: Date;
    /** Full override: skips freeze.json and the manifest entirely. */
    entries?: FreezeEntry[];
    /**
     * Manifest-declared freeze entries from an already-loaded manifest; merged
     * with freeze.json from disk (unlike `entries`, this never bypasses the
     * operator's `stations freeze add` gate).
     */
    manifestEntries?: FreezeEntry[];
}): FreezeEntry[];
/** Freeze gate check: returns the blocking entry when a package is frozen. */
export declare function findFreeze(packageName: string, entries: FreezeEntry[], now?: Date): FreezeEntry | null;
