export interface NyotaConfig { apiKey: string; }

export interface NYMeeting { id: string; title: string; date: string; duration: number; participants: string[]; status: string; recording_url: string | null; created_at: string; }
export interface NYMeetingList { meetings: NYMeeting[]; total: number; page: number; per_page: number; }
export interface NYTranscript { meeting_id: string; segments: { speaker: string; text: string; start: number; end: number }[]; }
export interface NYSummary { meeting_id: string; summary: string; key_points: string[]; action_items: NYActionItem[]; decisions: string[]; }
export interface NYActionItem { id: string; description: string; assignee: string; due_date: string | null; status: 'pending' | 'completed'; meeting_id: string; }

export class NyotaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'NyotaApiError'; this.statusCode = statusCode; }
}
