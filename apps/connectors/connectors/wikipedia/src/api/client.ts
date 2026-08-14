import type { WikipediaConfig } from '../types';
import { WikipediaApiError } from '../types';

export class WikipediaClient {
  private readonly lang: string;
  private readonly userAgent: string;
  private readonly baseUrl: string;

  constructor(config: WikipediaConfig = {}) {
    this.lang = config.language || 'en';
    this.userAgent = config.userAgent || 'open-connectors/1.0 (https://github.com/hasna/open-connectors)';
    this.baseUrl = config.baseUrl || `https://${this.lang}.wikipedia.org`;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { title?: string; detail?: string })?.title || response.statusText;
      throw new WikipediaApiError(msg, response.status);
    }
    return data as T;
  }

  setLanguage(lang: string): WikipediaClient {
    return new WikipediaClient({ language: lang, userAgent: this.userAgent });
  }
}
