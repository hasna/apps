export interface TextCortexConfig { apiKey: string; }

export interface TCGenerateResult { data: { outputs: { text: string; id: string }[] }; status: string; }
export interface TCCodeResult { data: { outputs: { text: string; id: string }[] }; status: string; }
export interface TCModel { id: string; name: string; description: string; category: string; }
export interface TCTemplate { id: string; name: string; description: string; input_fields: { name: string; type: string; required: boolean }[]; }

export class TextCortexApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TextCortexApiError'; this.statusCode = statusCode; }
}
