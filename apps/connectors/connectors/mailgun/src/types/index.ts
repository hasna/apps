export interface MailgunConfig { apiKey: string; domain: string; region?: 'us' | 'eu'; }

export interface MGMessage { id: string; message: string; }
export interface MGEvent { event: string; timestamp: number; recipient: string; tags: string[]; message: { headers: { subject: string; from: string; to: string } }; }
export interface MGEventList { items: MGEvent[]; paging: { next: string; previous: string }; }
export interface MGDomain { name: string; state: string; type: string; created_at: string; smtp_login: string; receiving_dns_records: { record_type: string; valid: string; value: string }[]; sending_dns_records: { record_type: string; valid: string; name: string; value: string }[]; }
export interface MGRoute { id: string; priority: number; description: string; expression: string; actions: string[]; created_at: string; }
export interface MGStats { time: string; delivered: { total: number }; failed: { permanent: { total: number }; temporary: { total: number } }; }
export interface MGSuppressionBounce { address: string; code: string; error: string; created_at: string; }

export class MailgunApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MailgunApiError'; this.statusCode = statusCode; }
}
