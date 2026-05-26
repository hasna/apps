import type { BrowserUseClient } from './client';
import type {
  BrowserSession,
  CreateBrowserSessionParams,
  ListBrowserSessionsParams,
  PaginatedResponse,
} from '../types';

/**
 * Browsers API (Direct CDP browser sessions)
 */
export class BrowsersApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * List all browser sessions
   */
  async list(params?: ListBrowserSessionsParams): Promise<PaginatedResponse<BrowserSession>> {
    return this.client.get<PaginatedResponse<BrowserSession>>('/v2/browsers', {
      limit: params?.limit,
      cursor: params?.cursor,
    });
  }

  /**
   * Create a new browser session
   */
  async create(params?: CreateBrowserSessionParams): Promise<BrowserSession> {
    return this.client.post<BrowserSession>('/v2/browsers', {
      profile_id: params?.profileId,
      proxy_url: params?.proxyUrl,
    });
  }

  /**
   * Get a browser session by ID
   */
  async get(browserId: string): Promise<BrowserSession> {
    return this.client.get<BrowserSession>(`/v2/browsers/${browserId}`);
  }

  /**
   * Stop a browser session
   */
  async stop(browserId: string): Promise<BrowserSession> {
    return this.client.patch<BrowserSession>(`/v2/browsers/${browserId}`, {
      action: 'stop',
    });
  }
}
