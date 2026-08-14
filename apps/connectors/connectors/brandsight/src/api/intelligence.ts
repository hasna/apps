import type { ConnectorClient } from './client';
import type { WhoisRecord, WhoisHistoryResult, ThreatAssessment } from '../types';

// ============================================
// Stub Data Generators
// ============================================

function generateStubWhoisHistory(_domain: string): WhoisRecord[] {
  return [
    {
      registrant: 'Privacy Proxy Service',
      date: '2023-01-15T00:00:00Z',
      changes: ['registrant_changed', 'nameserver_changed'],
    },
    {
      registrant: 'Original Owner LLC',
      date: '2020-06-01T00:00:00Z',
      changes: ['initial_registration'],
    },
  ];
}

function generateStubThreatAssessment(domain: string): Omit<ThreatAssessment, 'stub'> {
  return {
    domain,
    risk_level: 'low',
    threats: [],
    recommendation: 'No immediate threats detected. Continue routine monitoring.',
  };
}

/**
 * Brandsight Intelligence API
 * Endpoints: /domains/:domain/whois-history, /domains/:domain/threats
 */
export class IntelligenceApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get historical WHOIS records for a domain.
   */
  async getWhoisHistory(domain: string): Promise<WhoisHistoryResult> {
    const result = await this.client.request<{ history: WhoisRecord[] }>(
      `/domains/${encodeURIComponent(domain)}/whois-history`
    );

    if (result.stub) {
      return {
        domain,
        history: generateStubWhoisHistory(domain),
        stub: true,
      };
    }

    return {
      domain,
      history: result.data!.history,
      stub: false,
    };
  }

  /**
   * Get a threat assessment for a domain.
   */
  async getThreatAssessment(domain: string): Promise<ThreatAssessment> {
    const result = await this.client.request<Omit<ThreatAssessment, 'stub'>>(
      `/domains/${encodeURIComponent(domain)}/threats`
    );

    if (result.stub) {
      return {
        ...generateStubThreatAssessment(domain),
        stub: true,
      };
    }

    return {
      ...result.data!,
      stub: false,
    };
  }
}
