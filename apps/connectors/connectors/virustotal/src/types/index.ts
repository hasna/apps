export interface VirusTotalConfig { apiKey: string; }

export interface VTFileReport { data: { id: string; type: string; attributes: { meaningful_name: string; type_description: string; size: number; sha256: string; md5: string; sha1: string; last_analysis_stats: { malicious: number; suspicious: number; undetected: number; harmless: number; timeout: number }; last_analysis_date: number; reputation: number; tags: string[] } }; }
export interface VTUrlReport { data: { id: string; type: string; attributes: { url: string; last_final_url: string; last_http_response_content_length: number; last_analysis_stats: { malicious: number; suspicious: number; undetected: number; harmless: number }; last_analysis_date: number; reputation: number; categories: Record<string, string> } }; }
export interface VTDomainReport { data: { id: string; type: string; attributes: { last_dns_records: { type: string; value: string; ttl: number }[]; last_analysis_stats: { malicious: number; suspicious: number; undetected: number; harmless: number }; registrar: string; creation_date: number; reputation: number; categories: Record<string, string> } }; }
export interface VTScanResult { data: { id: string; type: string; links: { self: string } }; }
export interface VTComment { data: { id: string; attributes: { text: string; date: number; votes: { positive: number; negative: number; abuse: number } } }; }

export class VirusTotalApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'VirusTotalApiError'; this.statusCode = statusCode; }
}
