import type { Env } from "../env-token.js";
import { createClientTransport, type HasnaHttpTransport, type HasnaRequestOptions, type QueryParams } from "./transport.js";
/** Options for a list() call: filters/pagination as query params. */
export interface StorageListOptions extends Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal"> {
    /** Query params (limit, offset, cursor, filters, ...). */
    query?: QueryParams;
}
/** Options for a get() call. */
export type StorageGetOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query">;
/** Options for a create() call. */
export interface StorageCreateOptions extends Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query"> {
    /**
     * Idempotency key for the create. Defaults to a fresh UUID so a transparently
     * retried POST is deduped by the server instead of creating a duplicate. Pass
     * a stable value to make an app-level operation idempotent across calls.
     */
    idempotencyKey?: string;
}
/** Options for an update() call. */
export interface StorageUpdateOptions extends Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query"> {
    /** HTTP verb for the update. Default `PATCH` (partial); use `PUT` for replace. */
    method?: "PATCH" | "PUT";
    /** Idempotency key. PUT is idempotent by definition; set this to make PATCH retry-safe too. */
    idempotencyKey?: string;
}
/** Options for a delete() call. */
export type StorageDeleteOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query">;
/** Result of a list() call. `items` is the extracted array; `raw` is the full envelope. */
export interface StorageListResult<T> {
    items: T[];
    /** Total count when the server reports one (`total`/`count`), else null. */
    total: number | null;
    /** Opaque pagination cursor when the server reports one, else null. */
    cursor: string | null;
    /** The full parsed response body (envelope preserved). */
    raw: unknown;
}
/**
 * The app storage interface exposed by the authenticated service API.
 */
export interface HasnaStorageClient {
    /** App slug this client targets. */
    readonly name: string;
    /** `<origin>/v1` base URL. */
    readonly baseUrl: string;
    /** The underlying HTTP transport (escape hatch for non-CRUD routes). */
    readonly transport: HasnaHttpTransport;
    /** List a collection. Returns extracted `items` plus the raw envelope. */
    list<T = unknown>(resource: string, options?: StorageListOptions): Promise<StorageListResult<T>>;
    /** Fetch one entity by id. Returns `null` on 404. */
    get<T = unknown>(resource: string, id: string, options?: StorageGetOptions): Promise<T | null>;
    /** Create one entity. Retry-safe via an auto `Idempotency-Key`. */
    create<T = unknown>(resource: string, body: unknown, options?: StorageCreateOptions): Promise<T>;
    /** Update one entity by id (PATCH by default). */
    update<T = unknown>(resource: string, id: string, patch: unknown, options?: StorageUpdateOptions): Promise<T>;
    /** Delete one entity by id. Resolves for 2xx and 404 (already gone). */
    delete(resource: string, id: string, options?: StorageDeleteOptions): Promise<void>;
}
/**
 * Wrap an HTTP transport with the resource CRUD storage interface. Use this when
 * you already have a transport (e.g. from `createClientTransport`).
 */
export declare function createHasnaStorageClient(name: string, transport: HasnaHttpTransport): HasnaStorageClient;
/** Result of {@link resolveStorageClient}. */
export type ResolveStorageClientResult = {
    transport: "http";
    client: HasnaStorageClient;
};
/**
 * The one call an app's storage resolver makes. Reads the client-flip env for
 * `name`; returns a ready authenticated {@link HasnaStorageClient}. Missing,
 * blank, conflicting, or invalid configuration throws, so callers cannot
 * silently read or write a local dataset.
 */
export declare function resolveStorageClient(name: string, env?: Env, overrides?: Parameters<typeof createClientTransport>[2]): ResolveStorageClientResult;
