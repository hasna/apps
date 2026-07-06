/** The `ssl` field shape accepted by `pg.Pool` / `pg.Client`. */
export type PgSslConfig = boolean | {
    rejectUnauthorized: boolean;
    ca?: string;
};
export interface TlsResolveOptions {
    /** Inline CA bundle (PEM). Wins over every other CA source. */
    ca?: string;
    /** Path to a CA bundle PEM file, e.g. the Amazon RDS global bundle. */
    caCertPath?: string;
    /** Environment used to discover PGSSLROOTCERT / NODE_EXTRA_CA_CERTS. */
    env?: Record<string, string | undefined>;
}
export type SslMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";
/**
 * Extract the effective `sslmode` from a Postgres connection string. Honors the
 * `sslmode` query param and the legacy `ssl=true` boolean. Returns `disable`
 * when TLS is not requested.
 */
export declare function sslModeFromConnectionString(connectionString: string): SslMode;
/**
 * Resolve the `pg` ssl config for a connection string. See the module header
 * for the full mode table. Returns `undefined` when TLS should be off.
 */
export declare function resolveTlsConfig(connectionString: string, options?: TlsResolveOptions): PgSslConfig | undefined;
