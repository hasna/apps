import type { PandaDocConfig } from '../types';
import { PandaDocClient } from './client';
import { DocumentsApi } from './documents';
import { TemplatesApi } from './templates';
import { ContactsApi } from './contacts';
import { FoldersApi } from './folders';
import { MembersApi } from './members';
import { WebhooksApi } from './webhooks';
import { FormsApi } from './forms';
import { CatalogsApi } from './catalogs';
import { ContentLibraryApi } from './content-library';

/**
 * Main PandaDoc API client
 */
export class PandaDoc {
  private readonly client: PandaDocClient;

  // API modules
  public readonly documents: DocumentsApi;
  public readonly templates: TemplatesApi;
  public readonly contacts: ContactsApi;
  public readonly folders: FoldersApi;
  public readonly members: MembersApi;
  public readonly webhooks: WebhooksApi;
  public readonly forms: FormsApi;
  public readonly catalogs: CatalogsApi;
  public readonly contentLibrary: ContentLibraryApi;

  constructor(config: PandaDocConfig) {
    this.client = new PandaDocClient(config);
    this.documents = new DocumentsApi(this.client);
    this.templates = new TemplatesApi(this.client);
    this.contacts = new ContactsApi(this.client);
    this.folders = new FoldersApi(this.client);
    this.members = new MembersApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.forms = new FormsApi(this.client);
    this.catalogs = new CatalogsApi(this.client);
    this.contentLibrary = new ContentLibraryApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for PANDADOC_API_KEY or PANDADOC_ACCESS_TOKEN
   */
  static fromEnv(): PandaDoc {
    const apiKey = process.env.PANDADOC_API_KEY;
    const accessToken = process.env.PANDADOC_ACCESS_TOKEN;
    const baseUrl = process.env.PANDADOC_BASE_URL;

    if (!apiKey && !accessToken) {
      throw new Error('PANDADOC_API_KEY or PANDADOC_ACCESS_TOKEN environment variable is required');
    }

    return new PandaDoc({ apiKey, accessToken, baseUrl });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): PandaDocClient {
    return this.client;
  }
}

export { PandaDocClient } from './client';
export { DocumentsApi } from './documents';
export { TemplatesApi } from './templates';
export { ContactsApi } from './contacts';
export { FoldersApi } from './folders';
export { MembersApi } from './members';
export { WebhooksApi } from './webhooks';
export { FormsApi } from './forms';
export { CatalogsApi } from './catalogs';
export { ContentLibraryApi } from './content-library';
