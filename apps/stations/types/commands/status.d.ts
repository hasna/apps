import type { FleetStatus } from "../types.js";
export interface FleetStatusOptions {
    privateMetadata?: boolean;
    now?: Date;
    heartbeatTtlMs?: number | null;
}
export declare function getStatus(options?: FleetStatusOptions): FleetStatus;
