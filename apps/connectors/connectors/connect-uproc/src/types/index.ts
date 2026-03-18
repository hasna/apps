export interface UProcConfig { email: string; apiKey: string; baseUrl?: string; }
export interface UProcToolResult { ok: boolean; output?: string | number | boolean | Record<string, unknown>; error?: string; cost?: number; }
export interface UProcTool { id: string; name: string; description: string; category: string; input_fields: Array<{ name: string; type: string; required: boolean }>; }
export class UProcApiError extends Error { public readonly statusCode: number; constructor(message: string, statusCode: number) { super(message); this.name = 'UProcApiError'; this.statusCode = statusCode; } }
