import type {
  JsonRecord,
  ListQueryOptions,
  RawRequestOptions,
  WriteBinaryFileConfig,
} from '../types';
import { WriteBinaryFileClient } from './client';

export class WriteBinaryFile {
  private readonly client: WriteBinaryFileClient;

  constructor(config: WriteBinaryFileConfig) {
    this.client = new WriteBinaryFileClient(config);
  }

  async listFiles(query?: ListQueryOptions): Promise<JsonRecord> {
    return this.client.listFiles(query);
  }

  async createFile(body: JsonRecord): Promise<JsonRecord> {
    return this.client.createFile(body);
  }

  async getFile(fileId: string): Promise<JsonRecord> {
    return this.client.getFile(fileId);
  }

  async listEvents(query?: ListQueryOptions): Promise<JsonRecord> {
    return this.client.listEvents(query);
  }

  async search(body: JsonRecord): Promise<JsonRecord> {
    return this.client.search(body);
  }

  async rawRequest(options: RawRequestOptions): Promise<JsonRecord> {
    return this.client.rawRequest(options);
  }

  static fromEnv(): WriteBinaryFile {
    const apiKey = process.env.WRITE_BINARY_FILE_API_KEY;
    if (!apiKey) {
      throw new Error('WRITE_BINARY_FILE_API_KEY environment variable is required');
    }
    return new WriteBinaryFile({
      apiKey,
      baseUrl: process.env.WRITE_BINARY_FILE_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { WriteBinaryFileClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
