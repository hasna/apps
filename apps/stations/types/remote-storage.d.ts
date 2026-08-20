export declare const STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV = "HASNA_STATIONS_ALLOW_INSECURE_DATABASE_TLS";
export declare const STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV = "HASNA_STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED";
type Env = Record<string, string | undefined>;
export declare function sslConfigFor(connectionString: string, env?: Env): {
    rejectUnauthorized: boolean;
} | undefined;
export declare class PgAdapterAsync {
    private readonly pool;
    constructor(connectionString: string);
    run(sql: string, ...params: unknown[]): Promise<{
        changes: number;
    }>;
    all(sql: string, ...params: unknown[]): Promise<unknown[]>;
    close(): Promise<void>;
}
export {};
