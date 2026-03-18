export interface VoicitConfig { apiKey: string; }

export interface VCMeeting { id: string; title: string; date: string; duration: number; participants: string[]; status: string; language: string; created_at: string; }
export interface VCMeetingList { meetings: VCMeeting[]; total: number; page: number; per_page: number; }
export interface VCTranscript { meeting_id: string; segments: { speaker: string; text: string; start: number; end: number; confidence: number }[]; language: string; }
export interface VCSummary { meeting_id: string; summary: string; action_items: string[]; key_points: string[]; }

export class VoicitApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'VoicitApiError'; this.statusCode = statusCode; }
}
