export interface ZohoCRMConfig { accessToken: string; region?: 'com' | 'eu' | 'in' | 'au' | 'jp'; baseUrl?: string; }

export interface ZohoRecord { id: string; [key: string]: unknown; }
export interface ZohoLead extends ZohoRecord { First_Name?: string; Last_Name: string; Email?: string; Phone?: string; Company?: string; Lead_Source?: string; Status?: string; }
export interface ZohoContact extends ZohoRecord { First_Name?: string; Last_Name: string; Email?: string; Phone?: string; Account_Name?: string; Title?: string; }
export interface ZohoDeal extends ZohoRecord { Deal_Name: string; Account_Name?: string; Stage: string; Amount?: number; Closing_Date?: string; Owner?: { id: string; name: string }; }
export interface ZohoAccount extends ZohoRecord { Account_Name: string; Phone?: string; Website?: string; Industry?: string; Annual_Revenue?: number; }
export interface ZohoActivity extends ZohoRecord { Subject: string; Due_Date?: string; Status?: string; Priority?: string; }

export interface ZohoListResponse<T> { data: T[]; info: { page: number; per_page: number; count: number; more_records: boolean }; }
export interface ZohoCreateResponse { data: Array<{ code: string; details: { id: string }; message: string; status: string }>; }

export class ZohoCRMApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ZohoCRMApiError'; this.statusCode = statusCode; }
}
