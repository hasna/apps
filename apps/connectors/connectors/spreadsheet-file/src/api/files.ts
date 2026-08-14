import type { ConnectorClient } from './client';
import type {
  CreateFileParams,
  ListFilesParams,
  ListFilesResult,
  SpreadsheetFile,
} from '../types';

export class FilesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List spreadsheet files
   * GET /files
   */
  async list(params?: ListFilesParams): Promise<ListFilesResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.cursor) queryParams.cursor = params.cursor;

    return this.client.get<ListFilesResult>('/files', queryParams);
  }

  /**
   * Create a spreadsheet file
   * POST /files
   */
  async create(params: CreateFileParams): Promise<SpreadsheetFile> {
    return this.client.post<SpreadsheetFile>('/files', params);
  }

  /**
   * Get a spreadsheet file by ID
   * GET /files/{fileId}
   */
  async get(fileId: string): Promise<SpreadsheetFile> {
    return this.client.get<SpreadsheetFile>(`/files/${encodeURIComponent(fileId)}`);
  }
}
