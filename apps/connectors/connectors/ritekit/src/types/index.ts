export interface RiteKitConfig { clientId: string; }

export interface RKHashtagSuggestion { tag: string; tweets: number; retweets: number; exposure: number; links: number; photos: number; color: number; }
export interface RKAutoHashtag { text: string; hashtags: string[]; }
export interface RKEmoji { code: string; description: string; category: string; }
export interface RKImageText { url: string; }

export class RiteKitApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RiteKitApiError'; this.statusCode = statusCode; }
}
