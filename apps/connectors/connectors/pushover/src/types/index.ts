export interface PushoverConfig { token: string; userKey: string; baseUrl?: string; }
export interface PushoverMessage { token?: string; user: string; message: string; title?: string; url?: string; url_title?: string; priority?: -2 | -1 | 0 | 1 | 2; sound?: string; device?: string; timestamp?: number; html?: 0 | 1; }
export interface PushoverSendResult { status: number; request: string; errors?: string[]; }
export interface PushoverUser { status: number; group: number; devices: string[]; licenses: string[]; app_limits: { limit: number; remaining: number; reset: number }; }
export class PushoverApiError extends Error { public readonly statusCode: number; constructor(message: string, statusCode: number) { super(message); this.name = 'PushoverApiError'; this.statusCode = statusCode; } }
