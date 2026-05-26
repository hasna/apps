export interface JasperConfig { apiKey: string; baseUrl?: string; }

export interface JasperTemplate { id: string; name: string; description: string; inputSchema: Array<{ name: string; label: string; type: string; required: boolean }>; }
export interface JasperOutput { id: string; text: string; template_id: string; created_at: string; }
export interface JasperCommand { prompt: string; template_id?: string; inputs?: Record<string, string>; max_length?: number; tone?: string; language?: string; }
export interface JasperBrand { id: string; name: string; voice_description: string; }

export class JasperApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'JasperApiError'; this.statusCode = statusCode; }
}
