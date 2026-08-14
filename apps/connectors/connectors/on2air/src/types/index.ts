export interface On2AirConfig { apiKey: string; }

export interface O2ABackup { id: string; base_id: string; base_name: string; status: 'completed' | 'running' | 'failed'; tables_count: number; records_count: number; created_at: string; completed_at: string | null; download_url: string | null; }
export interface O2ABackupList { backups: O2ABackup[]; total: number; page: number; }
export interface O2ABase { id: string; name: string; tables: { id: string; name: string; fields: { id: string; name: string; type: string }[] }[]; }
export interface O2ASchedule { id: string; base_id: string; frequency: string; next_run: string; status: string; }

export class On2AirApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'On2AirApiError'; this.statusCode = statusCode; }
}
