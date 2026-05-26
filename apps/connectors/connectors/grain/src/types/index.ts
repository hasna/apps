export interface GrainConfig { token: string; }

export interface GrainRecording { id: string; title: string; date: string; duration: number; participants: string[]; status: string; url: string; created_at: string; }
export interface GrainRecordingList { recordings: GrainRecording[]; total: number; page: number; per_page: number; }
export interface GrainHighlight { id: string; recording_id: string; title: string; start_time: number; end_time: number; transcript: string; url: string; tags: string[]; created_at: string; }
export interface GrainHighlightList { highlights: GrainHighlight[]; total: number; }
export interface GrainCollection { id: string; name: string; description: string; highlight_count: number; created_at: string; }

export class GrainApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GrainApiError'; this.statusCode = statusCode; }
}
