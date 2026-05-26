export interface SwitchboardConfig { apiKey: string; }

export interface SWRoom { id: string; name: string; description: string; status: string; participants: string[]; created_at: string; updated_at: string; }
export interface SWRoomList { rooms: SWRoom[]; total: number; page: number; }
export interface SWApp { id: string; name: string; type: string; url: string; }
export interface SWParticipant { id: string; name: string; email: string; role: string; }

export class SwitchboardApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SwitchboardApiError'; this.statusCode = statusCode; }
}
