// YOURLS uses a different auth model — signature token, not Bearer
export interface YOURLSConfig { apiUrl: string; signatureToken: string; }

export interface YOURLSLink { keyword: string; url: string; title: string; date: string; ip: string; clicks: number; shorturl: string; }
export interface YOURLSStats { total_links: number; total_clicks: number; }
export interface YOURLSShortenResult { status: string; code: string; message: string; shorturl: string; title: string; url: { keyword: string; url: string; title: string; date: string; ip: string }; }

export class YOURLSApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'YOURLSApiError'; this.statusCode = statusCode; }
}
