import type { SedoClient } from './client';
import type {
  DomainSearchParams,
  DomainSearchResult,
  DomainListParams,
  AccountDomain,
  DomainStatusParams,
  DomainStatusResult,
  DomainInsertParams,
  Currency,
} from '../types';
import { CURRENCY_MAP } from '../types';

// Helper to convert currency code to string
function getCurrencyCode(currency: Currency): string {
  return CURRENCY_MAP[currency] || 'USD';
}

// Helper to extract text value from SOAP-style XML nodes
function getText(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === 'object' && '#text' in first) {
      return String(first['#text']);
    }
    return String(first || '');
  }
  if (typeof value === 'object' && '#text' in value) {
    return String(value['#text']);
  }
  return String(value);
}

// Helper to extract number from SOAP-style XML nodes
function getNumber(value: any): number {
  const text = getText(value);
  return parseFloat(text) || 0;
}

// Helper to extract integer from SOAP-style XML nodes
function getInt(value: any): number {
  const text = getText(value);
  return parseInt(text) || 0;
}

export class DomainsApi {
  constructor(private readonly client: SedoClient) {}

  /**
   * Search for domains in the Sedo marketplace
   */
  async search(params: DomainSearchParams): Promise<DomainSearchResult[]> {
    const response = await this.client.get<any>('DomainSearch', {
      keyword: params.keyword,
      tld: params.tld,
      kwtype: params.kwtype,
      no_hyphen: params.noHyphen ? 1 : undefined,
      no_numeral: params.noNumeral ? 1 : undefined,
      no_idn: params.noIdn ? 1 : undefined,
      resultsize: params.resultSize,
      language: params.language,
    });

    // Parse SEDOSEARCH response
    if (!response.SEDOSEARCH?.item) {
      return [];
    }

    const items = Array.isArray(response.SEDOSEARCH.item)
      ? response.SEDOSEARCH.item
      : [response.SEDOSEARCH.item];

    let results = items.map((item: any) => {
      const currency = getInt(item.currency) as Currency;
      return {
        domain: getText(item.domain),
        type: getText(item.type) as 'D' | 'W',
        price: getNumber(item.price),
        currency,
        currencyCode: getCurrencyCode(currency),
        rank: getInt(item.rank),
        url: getText(item.url),
      };
    });

    // Client-side filtering as workaround for Sedo API bugs
    // The API parameters don't always work correctly
    if (params.noNumeral) {
      results = results.filter(r => !/\d/.test(r.domain));
    }
    if (params.noHyphen) {
      results = results.filter(r => !r.domain.includes('-'));
    }
    if (params.noIdn) {
      // IDN domains have non-ASCII characters or start with xn--
      results = results.filter(r => /^[a-z0-9.-]+$/i.test(r.domain) && !r.domain.startsWith('xn--'));
    }

    return results;
  }

  /**
   * List domains in your Sedo account
   * Requires username/password to be configured
   */
  async list(params?: DomainListParams): Promise<AccountDomain[]> {
    if (!this.client.hasCredentials()) {
      throw new Error('Username and password are required for listing domains. Set them in your config.');
    }

    const response = await this.client.get<any>('DomainList', {
      startfrom: params?.startFrom,
      results: params?.results || 100,
      orderby: params?.orderBy,
      domain: params?.domains,
    });

    // Parse response
    if (!response.SEDODOMAINLIST?.item) {
      return [];
    }

    const items = Array.isArray(response.SEDODOMAINLIST.item)
      ? response.SEDODOMAINLIST.item
      : [response.SEDODOMAINLIST.item];

    return items.map((item: any) => {
      const currency = getInt(item.currency) as Currency;
      const forSaleVal = getText(item.forsale);
      const fixedPriceVal = getText(item.fixedprice);
      return {
        domain: getText(item.domain),
        categories: item.category ? (Array.isArray(item.category) ? item.category : [item.category]).map((c: any) => getInt(c)) : [],
        forSale: forSaleVal === '1' || forSaleVal === 'true',
        price: getNumber(item.price),
        minPrice: getNumber(item.minprice),
        fixedPrice: fixedPriceVal === '1' || fixedPriceVal === 'true',
        currency,
        currencyCode: getCurrencyCode(currency),
        language: getText(item.domainlanguage),
      };
    });
  }

  /**
   * Check status of domains on Sedo
   */
  async status(params: DomainStatusParams): Promise<DomainStatusResult[]> {
    const response = await this.client.get<any>('DomainStatus', {
      domainlist: params.domains,
    });

    // Parse response - Sedo returns SEDOLIST for status endpoint
    const statusData = response.SEDOLIST || response.SEDODOMAINSTATUS;
    if (!statusData?.item) {
      return [];
    }

    const items = Array.isArray(statusData.item)
      ? statusData.item
      : [statusData.item];

    return items.map((item: any) => {
      // Status endpoint returns currency as string (e.g., "USD"), not integer
      const currencyRaw = getText(item.currency);
      const currencyCode = currencyRaw || 'USD';
      // Reverse lookup to get currency integer
      const currency = currencyCode === 'EUR' ? 0 : currencyCode === 'GBP' ? 2 : 1 as Currency;
      const forSaleVal = getText(item.forsale);
      return {
        domain: getText(item.domain),
        type: getText(item.type) as 'D' | 'W',
        forSale: forSaleVal === '1' || forSaleVal === 'true',
        price: getNumber(item.price),
        currency,
        currencyCode,
        visitors: getInt(item.visitors),
        domainStatus: getInt(item.domainstatus) as 0 | 1,
      };
    });
  }

  /**
   * Insert/add a domain to your Sedo account
   * Requires username/password to be configured
   */
  async insert(params: DomainInsertParams): Promise<boolean> {
    if (!this.client.hasCredentials()) {
      throw new Error('Username and password are required for inserting domains. Set them in your config.');
    }

    await this.client.post<any>('DomainInsert', {
      domain: params.domain,
      category: params.category,
      forsale: params.forSale ? 1 : 0,
      price: params.price,
      minprice: params.minPrice,
      fixedprice: params.fixedPrice ? 1 : 0,
      currency: params.currency,
      domainlanguage: params.language,
    });

    return true;
  }

  /**
   * Delete a domain from your Sedo account
   * Requires username/password to be configured
   */
  async delete(domain: string): Promise<boolean> {
    if (!this.client.hasCredentials()) {
      throw new Error('Username and password are required for deleting domains. Set them in your config.');
    }

    await this.client.post<any>('DomainDelete', {
      domain,
    });

    return true;
  }

  /**
   * Edit domain settings
   * Requires username/password to be configured
   */
  async edit(params: DomainInsertParams): Promise<boolean> {
    if (!this.client.hasCredentials()) {
      throw new Error('Username and password are required for editing domains. Set them in your config.');
    }

    await this.client.post<any>('DomainEdit', {
      domain: params.domain,
      category: params.category,
      forsale: params.forSale !== undefined ? (params.forSale ? 1 : 0) : undefined,
      price: params.price,
      minprice: params.minPrice,
      fixedprice: params.fixedPrice !== undefined ? (params.fixedPrice ? 1 : 0) : undefined,
      currency: params.currency,
      domainlanguage: params.language,
    });

    return true;
  }
}
