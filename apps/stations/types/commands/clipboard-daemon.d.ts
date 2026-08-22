export declare function stopClipboardDaemon(): {
    stopped: boolean;
    pid: number | null;
};
export declare function startClipboardDaemon(port?: number): void;
