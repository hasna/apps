import { createServer } from "node:http";
import type { ClipboardConfig } from "../types.js";
export interface ClipboardServerOptions {
    port?: number;
    config?: ClipboardConfig;
}
export interface ClipboardServerHandle {
    server: ReturnType<typeof createServer>;
    port: number;
    close: () => Promise<void>;
}
export declare function getCurrentContentHash(): string | null;
export declare function setCurrentContentHash(hash: string): void;
export declare function startClipboardServer(options?: ClipboardServerOptions): ClipboardServerHandle;
export declare function pushClipboardToPeer(host: string, port: number, token: string): Promise<{
    sent: boolean;
    reason?: string;
}>;
