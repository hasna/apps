import { type ServerDataBackend } from "./schemas";
import { envToken, type Env } from "./env-token";
export { envToken };
export type { Env };
export interface ServerDataBackendEnvKeys {
    /** `HASNA_<NAME>_DATABASE_URL` then the optional `<NAME>_DATABASE_URL` alias. */
    databaseUrlKeys: string[];
}
/** Resolve the canonical environment keys for an app's server database. */
export declare function serverDataBackendEnvKeys(name: string): ServerDataBackendEnvKeys;
export interface ServerDataBackendResolution {
    backend: ServerDataBackend;
    /** Env key that selected PostgreSQL, or `"default"` for SQLite. */
    source: string;
    databaseUrlPresent: boolean;
    /** Env key the database URL came from, or `null`. */
    databaseUrlSource: string | null;
}
/**
 * Resolve the server backend from database configuration only.
 * Never returns or logs the database URL value.
 */
export declare function resolveServerDataBackend(name: string, env?: Env): ServerDataBackendResolution;
/** Resolve the database URL without logging it. Returns `null` when unset. */
export declare function resolveDatabaseUrl(name: string, env?: Env): string | null;
