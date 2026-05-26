export interface SupernormalConfig { apiKey: string; }

export interface SNMeeting { id: string; title: string; date: string; duration: number; participants: string[]; status: string; created_at: string; }
export interface SNMeetingList { meetings: SNMeeting[]; total: number; page: number; per_page: number; }
export interface SNTranscript { meeting_id: string; segments: { speaker: string; text: string; start: number; end: number }[]; }
export interface SNSummary { meeting_id: string; summary: string; action_items: string[]; key_points: string[]; decisions: string[]; }
export interface SNNote { id: string; meeting_id: string; content: string; created_at: string; updated_at: string; }

export class SupernormalApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SupernormalApiError'; this.statusCode = statusCode; }
}
