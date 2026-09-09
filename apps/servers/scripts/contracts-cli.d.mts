import type { SpawnSyncOptions } from "node:child_process";

export function resolveContractsCli(): string;
export function runContracts(args: string[], options?: SpawnSyncOptions): number;
