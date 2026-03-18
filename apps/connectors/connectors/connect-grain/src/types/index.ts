export interface GrainConfig { apiKey: string; baseUrl?: string; }

export interface GrainRecording { id: string; title: string; created_at: string; duration: number; participants: Array<{ name: string; email: string }>; transcript_url?: string; recording_url?: string; }
export interface GrainHighlight { id: string; recording_id: string; text: string; start_time: number; end_time: number; created_at: string; creator: { name: string; email: string }; }
export interface GrainStory { id: string; title: string; created_at: string; clips: Array<{ recording_id: string; start_time: number; end_time: number }>; }

export class GrainApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GrainApiError'; this.statusCode = statusCode; }
}
