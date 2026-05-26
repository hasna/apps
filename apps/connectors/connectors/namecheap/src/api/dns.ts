import type { ConnectorClient } from './client';
import type { DnsRecord } from '../types';
import { extractAllTags, extractAttributeFromElement } from '../utils/xml';

/**
 * Namecheap DNS API
 * Commands: namecheap.domains.dns.getHosts, setHosts
 */
export class DnsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get DNS host records for a domain
   * Command: namecheap.domains.dns.getHosts
   */
  async getHosts(sld: string, tld: string): Promise<DnsRecord[]> {
    const xml = await this.client.request('namecheap.domains.dns.getHosts', {
      SLD: sld,
      TLD: tld,
    });

    const hostElements = extractAllTags(xml, 'host');
    const records: DnsRecord[] = [];

    for (const el of hostElements) {
      const type = extractAttributeFromElement(el, 'Type');
      const name = extractAttributeFromElement(el, 'Name');
      const address = extractAttributeFromElement(el, 'Address');
      const hostId = extractAttributeFromElement(el, 'HostId');
      const mxPref = extractAttributeFromElement(el, 'MXPref');
      const ttl = extractAttributeFromElement(el, 'TTL');

      if (type && name && address) {
        records.push({
          hostId: hostId || undefined,
          type,
          name,
          address,
          mxPref: mxPref ? parseInt(mxPref) : undefined,
          ttl: ttl ? parseInt(ttl) : 1800,
        });
      }
    }

    return records;
  }

  /**
   * Set DNS host records for a domain
   * Command: namecheap.domains.dns.setHosts
   * NOTE: This replaces ALL records — you must include existing records you want to keep
   */
  async setHosts(sld: string, tld: string, records: DnsRecord[]): Promise<boolean> {
    const params: Record<string, string> = {
      SLD: sld,
      TLD: tld,
    };

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const idx = i + 1;
      params[`HostName${idx}`] = r.name;
      params[`RecordType${idx}`] = r.type;
      params[`Address${idx}`] = r.address;
      params[`TTL${idx}`] = String(r.ttl);
      if (r.mxPref !== undefined) {
        params[`MXPref${idx}`] = String(r.mxPref);
      }
    }

    await this.client.request('namecheap.domains.dns.setHosts', params);
    return true;
  }
}
