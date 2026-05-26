import type { CloudflareClient } from './client';
import type { SSLCertificate, SSLSettings, SSLVerification, CreateSSLCertificateParams, OriginCACertificate, CreateOriginCACertificateParams, CloudflareResponse } from '../types';

export class SSLApi {
  constructor(private client: CloudflareClient) {}

  // ============================================
  // SSL/TLS Settings
  // ============================================

  /**
   * Get SSL/TLS mode for a zone
   */
  async getMode(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.get<SSLSettings>(`/zones/${zoneId}/settings/ssl`);
    return response.result;
  }

  /**
   * Set SSL/TLS mode for a zone
   */
  async setMode(zoneId: string, mode: 'off' | 'flexible' | 'full' | 'strict'): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/ssl`,
      { value: mode }
    );
    return response.result;
  }

  /**
   * Get Always Use HTTPS setting
   */
  async getAlwaysUseHttps(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.get<SSLSettings>(`/zones/${zoneId}/settings/always_use_https`);
    return response.result;
  }

  /**
   * Enable Always Use HTTPS
   */
  async enableAlwaysUseHttps(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/always_use_https`,
      { value: 'on' }
    );
    return response.result;
  }

  /**
   * Disable Always Use HTTPS
   */
  async disableAlwaysUseHttps(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/always_use_https`,
      { value: 'off' }
    );
    return response.result;
  }

  /**
   * Get Automatic HTTPS Rewrites setting
   */
  async getAutomaticHttpsRewrites(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.get<SSLSettings>(`/zones/${zoneId}/settings/automatic_https_rewrites`);
    return response.result;
  }

  /**
   * Enable Automatic HTTPS Rewrites
   */
  async enableAutomaticHttpsRewrites(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/automatic_https_rewrites`,
      { value: 'on' }
    );
    return response.result;
  }

  /**
   * Disable Automatic HTTPS Rewrites
   */
  async disableAutomaticHttpsRewrites(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/automatic_https_rewrites`,
      { value: 'off' }
    );
    return response.result;
  }

  /**
   * Get minimum TLS version
   */
  async getMinTlsVersion(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.get<SSLSettings>(`/zones/${zoneId}/settings/min_tls_version`);
    return response.result;
  }

  /**
   * Set minimum TLS version
   */
  async setMinTlsVersion(zoneId: string, version: '1.0' | '1.1' | '1.2' | '1.3'): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/min_tls_version`,
      { value: version }
    );
    return response.result;
  }

  /**
   * Get Opportunistic Encryption setting
   */
  async getOpportunisticEncryption(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.get<SSLSettings>(`/zones/${zoneId}/settings/opportunistic_encryption`);
    return response.result;
  }

  /**
   * Enable Opportunistic Encryption
   */
  async enableOpportunisticEncryption(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/opportunistic_encryption`,
      { value: 'on' }
    );
    return response.result;
  }

  /**
   * Disable Opportunistic Encryption
   */
  async disableOpportunisticEncryption(zoneId: string): Promise<SSLSettings> {
    const response = await this.client.patch<SSLSettings>(
      `/zones/${zoneId}/settings/opportunistic_encryption`,
      { value: 'off' }
    );
    return response.result;
  }

  // ============================================
  // Universal SSL
  // ============================================

  /**
   * Get Universal SSL settings
   */
  async getUniversalSsl(zoneId: string): Promise<{
    enabled: boolean;
    certificate_authority?: string;
  }> {
    const response = await this.client.get<{
      enabled: boolean;
      certificate_authority?: string;
    }>(`/zones/${zoneId}/ssl/universal/settings`);
    return response.result;
  }

  /**
   * Enable Universal SSL
   */
  async enableUniversalSsl(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/ssl/universal/settings`, { enabled: true });
  }

  /**
   * Disable Universal SSL
   */
  async disableUniversalSsl(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/ssl/universal/settings`, { enabled: false });
  }

  // ============================================
  // Custom Certificates
  // ============================================

  /**
   * List custom SSL certificates
   */
  async listCertificates(
    zoneId: string,
    params?: {
      page?: number;
      per_page?: number;
      match?: 'any' | 'all';
      status?: string;
    }
  ): Promise<CloudflareResponse<SSLCertificate[]>> {
    return this.client.get<SSLCertificate[]>(`/zones/${zoneId}/custom_certificates`, params);
  }

  /**
   * Get a custom SSL certificate
   */
  async getCertificate(zoneId: string, certificateId: string): Promise<SSLCertificate> {
    const response = await this.client.get<SSLCertificate>(
      `/zones/${zoneId}/custom_certificates/${certificateId}`
    );
    return response.result;
  }

  /**
   * Upload a custom SSL certificate
   */
  async uploadCertificate(zoneId: string, params: CreateSSLCertificateParams): Promise<SSLCertificate> {
    const response = await this.client.post<SSLCertificate>(
      `/zones/${zoneId}/custom_certificates`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Update a custom SSL certificate
   */
  async updateCertificate(
    zoneId: string,
    certificateId: string,
    params: CreateSSLCertificateParams
  ): Promise<SSLCertificate> {
    const response = await this.client.patch<SSLCertificate>(
      `/zones/${zoneId}/custom_certificates/${certificateId}`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Delete a custom SSL certificate
   */
  async deleteCertificate(zoneId: string, certificateId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(
      `/zones/${zoneId}/custom_certificates/${certificateId}`
    );
    return response.result;
  }

  /**
   * Re-prioritize custom certificates
   */
  async prioritizeCertificates(
    zoneId: string,
    certificates: Array<{ id: string; priority: number }>
  ): Promise<SSLCertificate[]> {
    const response = await this.client.put<SSLCertificate[]>(
      `/zones/${zoneId}/custom_certificates/prioritize`,
      { certificates }
    );
    return response.result;
  }

  // ============================================
  // SSL Verification
  // ============================================

  /**
   * Get SSL verification status for a zone
   */
  async getVerification(zoneId: string): Promise<SSLVerification[]> {
    const response = await this.client.get<SSLVerification[]>(`/zones/${zoneId}/ssl/verification`);
    return response.result;
  }

  /**
   * Edit SSL verification method
   */
  async editVerification(
    zoneId: string,
    certPackId: string,
    method: 'http' | 'cname' | 'txt' | 'email'
  ): Promise<SSLVerification> {
    const response = await this.client.patch<SSLVerification>(
      `/zones/${zoneId}/ssl/verification/${certPackId}`,
      { validation_method: method }
    );
    return response.result;
  }

  // ============================================
  // Origin CA Certificates
  // ============================================

  /**
   * List Origin CA certificates
   */
  async listOriginCertificates(zoneId: string): Promise<CloudflareResponse<OriginCACertificate[]>> {
    return this.client.get<OriginCACertificate[]>('/certificates', { zone_id: zoneId });
  }

  /**
   * Get an Origin CA certificate
   */
  async getOriginCertificate(certificateId: string): Promise<OriginCACertificate> {
    const response = await this.client.get<OriginCACertificate>(`/certificates/${certificateId}`);
    return response.result;
  }

  /**
   * Create an Origin CA certificate
   */
  async createOriginCertificate(params: CreateOriginCACertificateParams): Promise<OriginCACertificate> {
    const response = await this.client.post<OriginCACertificate>(
      '/certificates',
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Revoke an Origin CA certificate
   */
  async revokeOriginCertificate(certificateId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(`/certificates/${certificateId}`);
    return response.result;
  }

  // ============================================
  // Client Certificates
  // ============================================

  /**
   * List client certificates
   */
  async listClientCertificates(
    zoneId: string,
    params?: {
      page?: number;
      per_page?: number;
      status?: 'all' | 'active' | 'pending_reactivation' | 'pending_revocation' | 'revoked';
    }
  ): Promise<CloudflareResponse<Array<{
    id: string;
    certificate: string;
    certificate_authority: {
      id: string;
      name: string;
    };
    common_name: string;
    country: string;
    csr: string;
    expires_on: string;
    fingerprint_sha256: string;
    issued_on: string;
    location: string;
    organization: string;
    organizational_unit: string;
    serial_number: string;
    signature: string;
    ski: string;
    state: string;
    status: string;
    validity_days: number;
  }>>> {
    return this.client.get<Array<{
      id: string;
      certificate: string;
      certificate_authority: {
        id: string;
        name: string;
      };
      common_name: string;
      country: string;
      csr: string;
      expires_on: string;
      fingerprint_sha256: string;
      issued_on: string;
      location: string;
      organization: string;
      organizational_unit: string;
      serial_number: string;
      signature: string;
      ski: string;
      state: string;
      status: string;
      validity_days: number;
    }>>(`/zones/${zoneId}/client_certificates`, params);
  }

  /**
   * Create a client certificate
   */
  async createClientCertificate(
    zoneId: string,
    params: {
      csr: string;
      validity_days: number;
    }
  ): Promise<{
    id: string;
    certificate: string;
    expires_on: string;
    issued_on: string;
    serial_number: string;
    signature: string;
    status: string;
  }> {
    const response = await this.client.post<{
      id: string;
      certificate: string;
      expires_on: string;
      issued_on: string;
      serial_number: string;
      signature: string;
      status: string;
    }>(`/zones/${zoneId}/client_certificates`, params);
    return response.result;
  }

  /**
   * Revoke a client certificate
   */
  async revokeClientCertificate(zoneId: string, certificateId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(
      `/zones/${zoneId}/client_certificates/${certificateId}`
    );
    return response.result;
  }
}
