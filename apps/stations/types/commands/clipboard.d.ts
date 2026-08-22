import type { ClipboardConfig, ClipboardEntry, ClipboardStatus } from "../types.js";
export declare function resolveConfigPath(configPath?: string): string;
export declare function resolveHistoryPath(historyPath?: string): string;
export declare function computeHash(content: string): string;
export declare function shouldSkipContent(content: string, skipPatterns: string[]): boolean;
export declare function sanitizeClipboardForRead(content: string, maxSizeBytes: number, skipPatterns: string[]): {
    ok: boolean;
    reason?: string;
};
export declare function getOrCreateClipboardKey(): string;
export declare function getDefaultClipboardConfig(): ClipboardConfig;
export declare function getConfigPath(configPath?: string): string;
export declare function readClipboardConfig(configPath?: string): ClipboardConfig;
export declare function writeClipboardConfig(config: ClipboardConfig, configPath?: string): void;
export declare function readClipboardHistory(historyPath?: string): ClipboardEntry[];
export declare function addClipboardEntry(entry: ClipboardEntry, historyPath?: string): void;
export declare function clearClipboardHistory(historyPath?: string): void;
export declare function getClipboardStatus(historyPath?: string): ClipboardStatus;
