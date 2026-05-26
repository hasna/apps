export interface ZohoWorkDriveConfig { token: string; teamId: string; baseUrl?: string; }

export interface ZWDFile { id: string; attributes: { name: string; type: string; extn: string; storage_info: { size: string }; created_time: string; modified_time: string; permalink: string; download_url: string }; }
export interface ZWDFolder { id: string; attributes: { name: string; type: string; created_time: string; modified_time: string; files_count: number; folders_count: number }; }
export interface ZWDTeam { id: string; attributes: { name: string; storage_info: { used: number; total: number } }; }
export interface ZWDUser { id: string; attributes: { email_id: string; display_name: string; role: string; status: string }; }

export class ZohoWorkDriveApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ZohoWorkDriveApiError'; this.statusCode = statusCode; }
}
