export interface NanonetsConfig { apiKey: string; }

export interface NNModel { model_id: string; model_type: string; status: string; categories: string[]; created_at: string; }
export interface NNPrediction { id: string; message: string; result: NNPage[]; }
export interface NNPage { page: number; prediction: NNField[]; }
export interface NNField { id: string; label: string; ocr_text: string; score: number; type: string; cells: { text: string; row: number; col: number; score: number }[]; }
export interface NNFile { id: string; file_url: string; status: string; created_at: string; }

export class NanonetsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'NanonetsApiError'; this.statusCode = statusCode; }
}
