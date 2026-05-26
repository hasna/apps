export interface VowelConfig { apiKey: string; }

export interface VWMeeting { id: string; title: string; date: string; duration: number; status: string; host: { id: string; name: string; email: string }; participants: { id: string; name: string; email: string }[]; recording_url: string | null; created_at: string; }
export interface VWMeetingList { meetings: VWMeeting[]; total: number; page: number; per_page: number; }
export interface VWTranscript { meeting_id: string; segments: { speaker: string; text: string; start: number; end: number }[]; }
export interface VWSummary { meeting_id: string; summary: string; action_items: string[]; key_topics: string[]; }
export interface VWBookmark { id: string; meeting_id: string; timestamp: number; note: string; created_by: string; }

export class VowelApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'VowelApiError'; this.statusCode = statusCode; }
}
