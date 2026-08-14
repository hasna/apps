export interface AlienVaultConfig { apiKey: string; }

export interface OTXPulse { id: string; name: string; description: string; author_name: string; created: string; modified: string; tags: string[]; references: string[]; adversary: string; targeted_countries: string[]; indicators: OTXIndicator[]; TLP: string; }
export interface OTXPulseList { results: OTXPulse[]; count: number; next: string | null; previous: string | null; }
export interface OTXIndicator { id: number; indicator: string; type: string; created: string; title: string; description: string; content: string; }
export interface OTXIPReputation { reputation: number; sections: string[]; city: string; country_name: string; asn: string; pulse_info: { count: number; pulses: OTXPulse[] }; }
export interface OTXDomainInfo { alexa: string; whois: string; indicator: string; pulse_info: { count: number; pulses: OTXPulse[] }; }
export interface OTXFileAnalysis { analysis: Record<string, unknown>; pulse_info: { count: number; pulses: OTXPulse[] }; }

export class AlienVaultApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AlienVaultApiError'; this.statusCode = statusCode; }
}
