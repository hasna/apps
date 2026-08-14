import type { ConnectorClient } from './client';
import type { Domain, DomainInfo, RenewResult, AvailabilityResult } from '../types';
import {
  extractAllTags,
  extractAttributeFromElement,
  extractTag,
  extractAttribute,
} from '../utils/xml';

/**
 * Namecheap Domains API
 * Commands: namecheap.domains.getList, getInfo, renew, check
 */
export class DomainsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List all domains in the Namecheap account
   * Command: namecheap.domains.getList
   */
  async list(options?: { page?: number; pageSize?: number }): Promise<Domain[]> {
    const xml = await this.client.request('namecheap.domains.getList', {
      PageSize: String(options?.pageSize ?? 100),
      Page: String(options?.page ?? 1),
    });

    const domainElements = extractAllTags(xml, 'Domain');
    const domains: Domain[] = [];

    for (const el of domainElements) {
      const name = extractAttributeFromElement(el, 'Name');
      const expires = extractAttributeFromElement(el, 'Expires');
      const autoRenew = extractAttributeFromElement(el, 'AutoRenew');
      const isLocked = extractAttributeFromElement(el, 'IsLocked');

      if (name) {
        domains.push({
          domain: name,
          expiry: expires || '',
          autoRenew: autoRenew === 'true',
          isLocked: isLocked === 'true',
        });
      }
    }

    return domains;
  }

  /**
   * Get detailed info for a specific domain
   * Command: namecheap.domains.getInfo
   */
  async getInfo(domain: string): Promise<DomainInfo> {
    const xml = await this.client.request('namecheap.domains.getInfo', {
      DomainName: domain,
    });

    const createdDate = extractTag(xml, 'CreatedDate') || extractAttribute(xml, 'DomainGetInfoResult', 'CreatedDate') || '';
    const expiresDate = extractTag(xml, 'ExpiredDate') || extractAttribute(xml, 'DomainGetInfoResult', 'ExpiredDate') || '';

    // Parse nameservers
    const nsSection = xml.match(/<DnsDetails[^>]*>([\s\S]*?)<\/DnsDetails>/i);
    const nameservers: string[] = [];
    if (nsSection) {
      const nsElements = nsSection[1].matchAll(/<Nameserver[^>]*>([^<]*)<\/Nameserver>/gi);
      for (const m of nsElements) {
        if (m[1]) nameservers.push(m[1].trim().toLowerCase());
      }
    }

    return {
      domain,
      registrar: 'Namecheap',
      created: createdDate,
      expires: expiresDate,
      nameservers,
    };
  }

  /**
   * Renew a domain
   * Command: namecheap.domains.renew
   */
  async renew(domain: string, years: number = 1): Promise<RenewResult> {
    const xml = await this.client.request('namecheap.domains.renew', {
      DomainName: domain,
      Years: String(years),
    });

    const transactionId = extractAttribute(xml, 'DomainRenewResult', 'TransactionID') || undefined;
    const chargedAmount = extractAttribute(xml, 'DomainRenewResult', 'ChargedAmount') || undefined;
    const orderId = extractAttribute(xml, 'DomainRenewResult', 'OrderID') || undefined;

    return {
      domain,
      success: true,
      transactionId,
      chargedAmount,
      orderId,
    };
  }

  /**
   * Check domain availability
   * Command: namecheap.domains.check
   */
  async check(domain: string): Promise<AvailabilityResult> {
    const xml = await this.client.request('namecheap.domains.check', {
      DomainList: domain,
    });

    const available = extractAttribute(xml, 'DomainCheckResult', 'Available');

    return {
      domain,
      available: available === 'true',
    };
  }
}
