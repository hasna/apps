export interface MatrixConfig { homeserver: string; accessToken: string; }

export interface MXRoom { room_id: string; name: string; topic: string; num_joined_members: number; canonical_alias: string | null; avatar_url: string | null; }
export interface MXEvent { event_id: string; type: string; content: Record<string, unknown>; sender: string; origin_server_ts: number; room_id: string; }
export interface MXMessage { event_id: string; type: string; content: { msgtype: string; body: string; format?: string; formatted_body?: string }; sender: string; origin_server_ts: number; }
export interface MXSync { next_batch: string; rooms: { join: Record<string, { timeline: { events: MXEvent[] } }>; invite: Record<string, unknown>; leave: Record<string, unknown> }; }
export interface MXUser { user_id: string; displayname: string; avatar_url: string | null; }
export interface MXRoomMessages { start: string; end: string; chunk: MXEvent[]; }

export class MatrixApiError extends Error {
  public readonly statusCode: number;
  public readonly errcode?: string;
  constructor(message: string, statusCode: number, errcode?: string) { super(message); this.name = 'MatrixApiError'; this.statusCode = statusCode; this.errcode = errcode; }
}
