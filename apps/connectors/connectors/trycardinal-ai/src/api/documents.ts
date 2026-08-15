import type { ConnectorClient } from './client';
import type { DocumentFormOptions } from '../types';

export class DocumentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async convertToMarkdown(options: DocumentFormOptions): Promise<unknown> {
    const formData = this.client.buildDocumentFormData(options);
    return this.client.requestMultipart('/markdown', formData);
  }

  async splitDocument(options: DocumentFormOptions): Promise<unknown> {
    const formData = this.client.buildDocumentFormData(options);
    return this.client.requestMultipart('/split', formData);
  }
}
