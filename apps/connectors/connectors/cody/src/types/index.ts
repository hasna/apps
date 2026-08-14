export interface CodyConfig { token: string; endpoint?: string; }

export interface CodyCompletion { completion: string; stopReason: string; }
export interface CodySearchResult { results: { repository: string; file: string; content: string; url: string; score: number }[]; }
export interface CodyRepository { name: string; url: string; description: string; stars: number; }

export class CodyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CodyApiError'; this.statusCode = statusCode; }
}
