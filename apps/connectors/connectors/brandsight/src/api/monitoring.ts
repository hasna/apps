import type { ConnectorClient } from './client';
import type { BrandAlert, BrandMonitorResult, SimilarDomain } from '../types';

// ============================================
// Stub Data Generators
// ============================================

function generateStubAlerts(brandName: string): BrandAlert[] {
  const now = new Date().toISOString();
  return [
    {
      domain: `${brandName}-deals.com`,
      type: 'keyword',
      registered_at: now,
    },
    {
      domain: `${brandName.replace(/a/gi, '4').replace(/e/gi, '3')}.com`,
      type: 'homoglyph',
      registered_at: now,
    },
    {
      domain: `${brandName}s.com`,
      type: 'typosquat',
      registered_at: now,
    },
  ];
}

function generateStubSimilarDomains(domain: string): string[] {
  const base = domain.replace(/\.[^.]+$/, '');
  const tld = domain.slice(base.length);
  return [
    `${base}-online${tld}`,
    `${base}s${tld}`,
    `${base.replace(/a/gi, '4')}${tld}`,
    `${base}-app${tld}`,
    `get${base}${tld}`,
  ];
}

/**
 * Brandsight Monitoring API
 * Endpoints: /brands/:name/monitor, /domains/:domain/similar
 */
export class MonitoringApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Monitor a brand name for new domain registrations that are similar.
   */
  async monitorBrand(name: string): Promise<BrandMonitorResult> {
    const result = await this.client.request<{ alerts: BrandAlert[] }>(
      `/brands/${encodeURIComponent(name)}/monitor`
    );

    if (result.stub) {
      return {
        brand: name,
        alerts: generateStubAlerts(name),
        stub: true,
      };
    }

    return {
      brand: name,
      alerts: result.data!.alerts,
      stub: false,
    };
  }

  /**
   * Find typosquat/competing domains similar to the given domain.
   */
  async getSimilarDomains(domain: string): Promise<SimilarDomain> {
    const result = await this.client.request<{ similar: string[] }>(
      `/domains/${encodeURIComponent(domain)}/similar`
    );

    if (result.stub) {
      return {
        domain,
        similar: generateStubSimilarDomains(domain),
        stub: true,
      };
    }

    return {
      domain,
      similar: result.data!.similar,
      stub: false,
    };
  }
}
