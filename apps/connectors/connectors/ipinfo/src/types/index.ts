export interface IPinfoConfig { token: string; }

export interface IPDetails { ip: string; hostname: string; city: string; region: string; country: string; loc: string; org: string; postal: string; timezone: string; asn?: { asn: string; name: string; domain: string; route: string; type: string }; company?: { name: string; domain: string; type: string }; privacy?: { vpn: boolean; proxy: boolean; tor: boolean; relay: boolean; hosting: boolean; service: string }; abuse?: { address: string; country: string; email: string; name: string; network: string; phone: string }; }
export interface IPASNDetails { asn: string; name: string; country: string; allocated: string; registry: string; domain: string; num_ips: number; type: string; prefixes: { netblock: string; id: string; name: string; country: string; size: string }[]; }
export interface IPRanges { domain: string; num_ranges: number; ranges: string[]; }

export class IPinfoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'IPinfoApiError'; this.statusCode = statusCode; }
}
