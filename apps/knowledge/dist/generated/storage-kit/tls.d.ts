export type PgSslConfig = boolean | {
    rejectUnauthorized: boolean;
    ca?: string;
};
export interface TlsResolveOptions {
    ca?: string;
    caCertPath?: string;
    env?: Record<string, string | undefined>;
}
export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
export declare function sslModeFromConnectionString(connectionString: string): SslMode;
export declare function resolveTlsConfig(connectionString: string, options?: TlsResolveOptions): PgSslConfig | undefined;
