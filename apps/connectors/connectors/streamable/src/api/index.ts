import { StreamableClient, requireString } from './client';
import type { StreamableOEmbed, StreamableVideo } from '../types';

export { StreamableClient } from './client';

/**
 * Streamable read-only video API connector.
 * @see https://streamable.com/documentation
 */
export class Streamable {
  private readonly client: StreamableClient;

  constructor(client = new StreamableClient()) {
    this.client = client;
  }

  async getVideo(shortcode: string): Promise<StreamableVideo> {
    const code = requireString(shortcode, 'shortcode');
    return this.client.request<StreamableVideo>(`/videos/${encodeURIComponent(code)}`);
  }

  async getOEmbed(url: string): Promise<StreamableOEmbed> {
    return this.client.request<StreamableOEmbed>('/oembed.json', {
      params: { url: requireString(url, 'url') },
    });
  }

  getClient(): StreamableClient {
    return this.client;
  }
}
