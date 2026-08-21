import type { CapturedRead } from "../safe-read";
export interface VerifyWriteCliOptions {
    authored: string;
    idPath?: string;
    contentPath?: string;
    json?: boolean;
}
interface VerifyWriteCliIo {
    log: (line: string) => void;
    err: (line: string) => void;
}
export declare function runVerifyWriteCli(targetId: string, argv: string[], options: VerifyWriteCliOptions, io?: VerifyWriteCliIo, run?: (argv: string[]) => CapturedRead): number;
export {};
