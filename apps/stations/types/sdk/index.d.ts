export * from "./generated-client.js";
import { StationsClient, type StationsClientOptions } from "./generated-client.js";
export declare const STATIONS_API_URL_ENV = "STATIONS_API_URL";
export declare const STATIONS_API_KEY_ENV = "STATIONS_API_KEY";
/**
 * Build a StationsClient from the environment (API-client mode).
 * Requires STATIONS_API_URL; STATIONS_API_KEY is required for any /v1 call.
 */
export declare function stationsClientFromEnv(env?: NodeJS.ProcessEnv, overrides?: Partial<StationsClientOptions>): StationsClient;
