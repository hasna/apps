export interface ZohoCRMConfig { token: string; baseUrl?: string; }

export interface ZohoRecord { id: string; [key: string]: unknown; }
export interface ZohoRecordList { data: ZohoRecord[]; info: { per_page: number; count: number; page: number; more_records: boolean }; }
export interface ZohoModule { api_name: string; module_name: string; singular_label: string; plural_label: string; id: string; }
export interface ZohoField { id: string; api_name: string; field_label: string; data_type: string; length: number; required: boolean; read_only: boolean; }
export interface ZohoUser { id: string; name: string; email: string; role: { id: string; name: string }; profile: { id: string; name: string }; status: string; }
export interface ZohoNote { id: string; Note_Title: string; Note_Content: string; Parent_Id: { id: string; name: string }; Created_Time: string; }

export class ZohoCRMApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  constructor(message: string, statusCode: number, code?: string) { super(message); this.name = 'ZohoCRMApiError'; this.statusCode = statusCode; this.code = code; }
}
