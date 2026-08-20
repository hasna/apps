import { type HasnaStorageClient } from "./storage.js";
import type { Env } from "./mode.js";
export type CloudStorageResolution = {
    transport: "local";
    client: null;
} | {
    transport: "cloud-http";
    client: HasnaStorageClient;
    baseUrl: string;
};
/**
 * Resolve whether `name`'s data lives in the cloud (hosted `/v1` API) or the
 * local store for the current environment. Never returns partially-built cloud
 * state and never exposes the API key. Throws on a partial API env pair or a
 * set storage-mode variable.
 */
export declare function resolveCloudStorage(name: string, env?: Env): CloudStorageResolution;
