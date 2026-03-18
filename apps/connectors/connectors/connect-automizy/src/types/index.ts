export interface AutomizyConfig { token: string; }

export interface AZContact { id: number; email: string; status: string; firstname: string; lastname: string; tags: string[]; custom_fields: Record<string, string>; created_at: string; updated_at: string; }
export interface AZContactList { contacts: AZContact[]; page: number; page_count: number; limit: number; total_contacts: number; }
export interface AZSmartList { id: number; name: string; contacts_count: number; created_at: string; }
export interface AZCampaign { id: number; name: string; status: string; subject: string; from_name: string; from_email: string; sent_at: string | null; created_at: string; open_rate: number; click_rate: number; }
export interface AZAutomation { id: number; name: string; status: string; contacts_count: number; created_at: string; }
export interface AZTag { id: number; name: string; contacts_count: number; }
export interface AZForm { id: number; name: string; submissions_count: number; created_at: string; }

export class AutomizyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AutomizyApiError'; this.statusCode = statusCode; }
}
