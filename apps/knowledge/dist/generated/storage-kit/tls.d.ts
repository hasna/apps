/** The `ssl` field shape accepted by `pg.Pool` / `pg.Client`. */
export type PgSslConfig = boolean | {
    rejectUnauthorized: boolean;
    ca?: string;
    cert?: string;
    key?: string;
    passphrase?: string;
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
 * Remove the TLS query parameters once this module has resolved them into an
 * explicit `ssl` option. pg re-parses `connectionString` AFTER merging pool
 * options and lets the parse win, so leaving `sslmode` (or `ssl`, `sslcert`,
 * `sslkey`, `sslrootcert`, `sslnegotiation`) in the URL replaces the resolved
 * SSL object with pg's own — discarding the CA bundle with it.
 *
 * Non-TLS parameters and any fragment are preserved exactly.
 */
export declare function connectionStringWithoutTlsParameters(connectionString: string): string;
/**
 * Preserve pg's transport negotiation choice outside the stripped URL, so
 * `sslnegotiation=direct` survives as an explicit pool option instead of being
 * silently dropped.
 */
export declare function sslNegotiationFromConnectionString(connectionString: string): "postgres" | "direct" | undefined;
/**
 * Extract the effective `sslmode` from a Postgres connection string. Honors the
 * `sslmode` query param, the legacy `ssl=true` boolean, and pg's rule that
 * `sslnegotiation=direct` implies TLS when no explicit SSL setting is present.
 * Returns `disable` when TLS is not requested.
 */
export declare function sslModeFromConnectionString(connectionString: string): SslMode;
/**
 * Resolve the `pg` ssl config for a connection string. See the module header
 * for the full mode table.
 *
 * Returns `false` when TLS was explicitly switched off, and `undefined` when the
 * DSN expressed no TLS policy at all — those are different answers, and pg
 * treats them differently: only `undefined` lets `PGSSLMODE` decide.
 *
 * The caller MUST hand pg `connectionStringWithoutTlsParameters(connectionString)`
 * rather than the original DSN, or pg discards everything resolved here.
 */
export declare function resolveTlsConfig(connectionString: string, options?: TlsResolveOptions): PgSslConfig | undefined;
