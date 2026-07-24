import { type Stats } from 'node:fs';
export declare class AnchoredFilesystemError extends Error {
    readonly name = "AnchoredFilesystemError";
}
export interface AnchoredIdentity {
    readonly dev: number;
    readonly ino: number;
    readonly mode: number;
}
export declare const MAX_ANCHORED_CONFIG_BYTES = 1048576;
export declare const MAX_ANCHORED_ARTIFACT_BYTES = 8388608;
export declare const MAX_ANCHORED_ARTIFACT_NODES = 4096;
export declare const ANCHORED_FILESYSTEM_SUPPORT: Readonly<{
    supportedPlatforms: readonly ["linux", "darwin"];
    unsupportedBehavior: "fail-closed-before-filesystem-io";
}>;
export declare function assertAnchoredFilesystemPlatform(platform?: NodeJS.Platform): void;
export type AnchoredFsTestEvent = 'config-before-parent-check' | 'config-before-target-move' | 'config-before-final-verify' | 'snapshot-before-read' | 'snapshot-after-read' | 'artifact-before-read' | 'artifact-before-component-open' | 'artifact-before-atomic-install' | 'artifact-before-final-verify' | 'database-before-constructor' | 'database-before-migration';
interface AnchoredArtifactLockTestControl {
    readonly monotonicNow?: () => number;
    readonly wait?: (milliseconds: number) => void;
}
/** Deterministic same-key lock control for repository tests; not exported by the package root. */
export declare function setAnchoredArtifactLockTestControl(control: AnchoredArtifactLockTestControl | undefined): void;
/** Deterministic race injection for repository tests; never exported by the package root. */
export declare function setAnchoredFsTestHook(hook: ((event: AnchoredFsTestEvent, detail: string) => void) | undefined): void;
/** Ensure a directory using only no-follow component opens rooted at `/`. */
export declare function ensureAnchoredDirectory(path: string, mode?: number): AnchoredIdentity;
/** Inspect an existing directory without following any path component. */
export declare function anchoredDirectoryIdentity(path: string): AnchoredIdentity | undefined;
/** Open one directory identity and keep every child operation fd-relative. */
export declare class AnchoredDirectoryHandle {
    readonly path: string;
    readonly identity: AnchoredIdentity;
    private fd;
    constructor(path: string);
    private descriptor;
    private safeName;
    private child;
    verifyDescriptor(): void;
    verify(): void;
    lstat(name: string): Stats | undefined;
    open(name: string, flags: number, mode?: number): number;
    link(source: string, target: string): void;
    rename(source: string, target: string): void;
    unlink(name: string): void;
    entries(prefix?: string): string[];
    sync(): void;
    close(): void;
}
export interface AnchoredMutableFileSnapshot {
    readonly dev: number;
    readonly ino: number;
    readonly mode: number;
    readonly size: number;
    readonly nlink: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}
/** A no-follow, parent-fd-anchored regular file kept open for identity-bound consumers. */
export declare class AnchoredMutableFileHandle {
    private readonly parent;
    readonly name: string;
    readonly descriptorPath: string;
    readonly initial: AnchoredMutableFileSnapshot;
    private fd;
    constructor(parent: AnchoredDirectoryHandle, name: string, fd: number);
    private descriptor;
    snapshot(): AnchoredMutableFileSnapshot;
    verifyIdentity(): AnchoredMutableFileSnapshot;
    verifyUnchanged(expected: AnchoredMutableFileSnapshot): AnchoredMutableFileSnapshot;
    close(): void;
}
export declare function openAnchoredMutableRegularFile(path: string, options?: {
    create?: boolean;
    mode?: number;
}): AnchoredMutableFileHandle;
/** Read a regular file relative to an opened, no-follow parent chain. */
export interface AnchoredRegularFileSnapshot {
    readonly content: string;
    readonly identity: AnchoredIdentity;
}
export declare function readAnchoredRegularFileSnapshot(path: string, maxBytes?: number): AnchoredRegularFileSnapshot | undefined;
/** Read a bounded regular file relative to an opened, no-follow parent chain. */
export declare function readAnchoredRegularFile(path: string): string | undefined;
/**
 * Replace a config-like regular file without ever overwriting a racing target.
 * Existing files are moved to a same-directory backup and identity-checked
 * before the new inode is linked into place.
 */
export declare function writeAnchoredRegularFile(path: string, body: string, mode?: number): void;
/** Root-anchored, symlink-free local artifact operations. */
export declare class AnchoredArtifactDirectory {
    readonly path: string;
    private readonly expected;
    constructor(path: string);
    private openRoot;
    put(relativePath: string, body: string | Uint8Array): {
        modifiedAt: Date;
    };
    read(relativePath: string): string;
    exists(relativePath: string): boolean;
    delete(relativePath: string): void;
    list(prefix?: string): string[];
}
export {};
