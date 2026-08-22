export * from "./generated-client.js";
import { MachinesClient, type MachinesClientOptions } from "./generated-client.js";
export declare const MACHINES_API_URL_ENV = "MACHINES_API_URL";
export declare const MACHINES_API_KEY_ENV = "MACHINES_API_KEY";
/**
 * Build a MachinesClient from the environment (API-client mode).
 * Requires MACHINES_API_URL; MACHINES_API_KEY is required for any /v1 call.
 */
export declare function machinesClientFromEnv(env?: NodeJS.ProcessEnv, overrides?: Partial<MachinesClientOptions>): MachinesClient;
