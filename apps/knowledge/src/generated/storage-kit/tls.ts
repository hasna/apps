// @generated from the @hasna/contracts 0.4.0 declarations; Stage-A runtime containment stub.
import { KnowledgeContainmentError } from '../../runtime-role.js';

export type PgSslConfig = boolean | { rejectUnauthorized: boolean; ca?: string };

export interface TlsResolveOptions {
  ca?: string;
  caCertPath?: string;
  env?: Record<string, string | undefined>;
}

export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

function containedTls(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED', 503, 'hosted-client', 'public-api',
    'database TLS capability is unavailable during Stage A',
  );
}

export function sslModeFromConnectionString(connectionString: string): SslMode {
  return containedTls();
}

export function resolveTlsConfig(
  connectionString: string,
  options?: TlsResolveOptions,
): PgSslConfig | undefined;
export function resolveTlsConfig(connectionString: string): PgSslConfig | undefined {
  return containedTls();
}
