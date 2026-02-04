import type { GoogleDocsConfig } from '../types';
import { GoogleDocsClient } from './client';
import { DocumentsApi } from './documents';
import { ContentApi } from './content';
import { StylesApi } from './styles';

/**
 * Google Docs API client
 * Provides access to Google Docs API v1 endpoints
 */
export class GoogleDocs {
  private readonly client: GoogleDocsClient;

  // API modules
  public readonly documents: DocumentsApi;
  public readonly content: ContentApi;
  public readonly styles: StylesApi;

  constructor(config: GoogleDocsConfig) {
    this.client = new GoogleDocsClient(config);
    this.documents = new DocumentsApi(this.client);
    this.content = new ContentApi(this.client);
    this.styles = new StylesApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for GOOGLE_ACCESS_TOKEN (preferred) or GOOGLE_API_KEY
   */
  static fromEnv(): GoogleDocs {
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!accessToken && !apiKey) {
      throw new Error('GOOGLE_ACCESS_TOKEN or GOOGLE_API_KEY environment variable is required');
    }
    return new GoogleDocs({ accessToken, apiKey });
  }

  /**
   * Get a preview of the credentials (for debugging)
   */
  getCredentialsPreview(): string {
    return this.client.getCredentialsPreview();
  }

  /**
   * Check if client has write access (OAuth token)
   */
  hasWriteAccess(): boolean {
    return this.client.hasWriteAccess();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GoogleDocsClient {
    return this.client;
  }
}

export { GoogleDocsClient } from './client';
export { DocumentsApi } from './documents';
export { ContentApi } from './content';
export { StylesApi } from './styles';
