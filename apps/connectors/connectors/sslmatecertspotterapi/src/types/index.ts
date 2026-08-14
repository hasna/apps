export interface CertSpotterConfig { apiKey: string; }

export interface CSCertificate { id: string; tbs_sha256: string; dns_names: string[]; pubkey_sha256: string; issuer: { friendly_name: string; caa_domains: string[] }; not_before: string; not_after: string; cert_sha256: string; }
export interface CSIssuance { id: string; tbs_sha256: string; cert_sha256: string; dns_names: string[]; pubkey_sha256: string; not_before: string; not_after: string; issuer: { name: string; caa_domains: string[] }; }

export class CertSpotterApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CertSpotterApiError'; this.statusCode = statusCode; }
}
