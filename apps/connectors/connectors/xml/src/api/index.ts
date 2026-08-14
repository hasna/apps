import type {
  RawRequestOptions,
  XmlConfig,
  XmlDocument,
  XmlEvent,
  XmlSearchResult,
} from '../types';
import { encodePathSegment, XmlClient } from './client';

/**
 * XML.com API connector — documents, events, and search.
 */
export class Xml {
  private readonly client: XmlClient;

  constructor(config: XmlConfig) {
    this.client = new XmlClient(config);
  }

  static fromEnv(): Xml {
    const apiKey = process.env.XML_API_KEY;
    if (!apiKey) {
      throw new Error('XML_API_KEY environment variable is required');
    }
    return new Xml({
      apiKey,
      baseUrl: process.env.XML_BASE_URL,
    });
  }

  async listDocuments(
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<XmlDocument[] | Record<string, unknown>> {
    return this.client.get('/documents', query);
  }

  async createDocument(
    body: Record<string, unknown>,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<XmlDocument> {
    return this.client.post('/documents', body, query);
  }

  async getDocument(documentId: string): Promise<XmlDocument> {
    const encoded = encodePathSegment(documentId);
    return this.client.get(`/documents/${encoded}`);
  }

  async listEvents(
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<XmlEvent[] | Record<string, unknown>> {
    return this.client.get('/events', query);
  }

  async search(
    body: Record<string, unknown>,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<XmlSearchResult> {
    return this.client.post('/search', body, query);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): XmlClient {
    return this.client;
  }
}

export { XmlClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
