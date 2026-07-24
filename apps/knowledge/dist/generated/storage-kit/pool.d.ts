import type { Pool } from 'pg';
import type { TlsResolveOptions } from './tls.js';
import type { PoolQueryClient } from './query.js';
export interface CreatePgPoolOptions extends TlsResolveOptions {
    connectionString: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    applicationName?: string;
}
export interface CreateCloudPoolFromEnvOptions extends TlsResolveOptions {
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    applicationName?: string;
}
export interface CloudPoolFromEnv {
    client: PoolQueryClient;
    connectionSource: string;
}
export declare function createPgPool(options: CreatePgPoolOptions): Pool;
export declare function createCloudPoolFromEnv(appName: string, options?: CreateCloudPoolFromEnvOptions): CloudPoolFromEnv;
