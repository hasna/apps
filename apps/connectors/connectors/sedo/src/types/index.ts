// Sedo API Configuration
export interface SedoConfig {
  partnerId: string;
  signKey: string;
  username?: string;
  password?: string;
  baseUrl?: string;
}

// Currency codes
export type Currency = 0 | 1 | 2; // 0=EUR, 1=USD, 2=GBP
export const CURRENCY_MAP: Record<Currency, string> = {
  0: 'EUR',
  1: 'USD',
  2: 'GBP',
};

// Domain search parameters
export interface DomainSearchParams {
  keyword: string;
  tld?: string;
  kwtype?: 'B' | 'C' | 'E'; // Begins, Contains, Ends
  noHyphen?: boolean;
  noNumeral?: boolean;
  noIdn?: boolean;
  resultSize?: number;
  language?: string;
}

// Domain search result
export interface DomainSearchResult {
  domain: string;
  type: 'D' | 'W'; // Domain or Website
  price: number;
  currency: Currency;
  currencyCode: string;
  rank: number; // 1=exact, 2=begins, 3=ends, 4=contains
  url: string;
}

// Domain list parameters
export interface DomainListParams {
  startFrom?: number;
  results?: number;
  orderBy?: 0 | 1; // 0=domain name, 1=insert date
  domains?: string[];
}

// Domain in account
export interface AccountDomain {
  domain: string;
  categories: number[];
  forSale: boolean;
  price: number;
  minPrice: number;
  fixedPrice: boolean;
  currency: Currency;
  currencyCode: string;
  language: string;
}

// Domain status parameters
export interface DomainStatusParams {
  domains: string[];
}

// Domain status result
export interface DomainStatusResult {
  domain: string;
  type: 'D' | 'W';
  forSale: boolean;
  price: number;
  currency: Currency;
  currencyCode: string;
  visitors: number;
  domainStatus: 0 | 1; // 0=not in database, 1=in database
}

// Domain insert parameters
export interface DomainInsertParams {
  domain: string;
  category?: number;
  forSale?: boolean;
  price?: number;
  minPrice?: number;
  fixedPrice?: boolean;
  currency?: Currency;
  language?: string;
}

// API Error
export class SedoApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'SedoApiError';
  }
}

// Output format for CLI
export type OutputFormat = 'json' | 'table' | 'pretty';
