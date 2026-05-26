export interface ZulipConfig { email: string; apiKey: string; serverUrl: string; }

export interface ZulipMessage { id: number; sender_id: number; sender_email: string; sender_full_name: string; type: 'stream' | 'private'; content: string; subject: string; display_recipient: string | Array<{ email: string; full_name: string }>; timestamp: number; }
export interface ZulipStream { stream_id: number; name: string; description: string; invite_only: boolean; is_web_public: boolean; subscribers?: number[]; }
export interface ZulipUser { user_id: number; email: string; full_name: string; is_bot: boolean; is_active: boolean; role: number; avatar_url: string | null; }
export interface ZulipTopic { name: string; max_id: number; }

export class ZulipApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ZulipApiError'; this.statusCode = statusCode; }
}
