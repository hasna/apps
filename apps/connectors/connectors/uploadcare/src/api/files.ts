import type { UploadcareClient } from './client';
import type { UploadcareFile, UploadcareFileList } from '../types';

function filePath(uuid: string): string {
  return `/files/${encodeURIComponent(uuid)}`;
}

export class FilesApi {
  constructor(private readonly client: UploadcareClient) {}

  async list(params?: {
    limit?: number;
    from?: string;
    to?: string;
    stored?: boolean;
    removed?: boolean;
    ordering?: string;
  }): Promise<UploadcareFileList> {
    return this.client.get<UploadcareFileList>('/files', params);
  }

  async get(uuid: string): Promise<UploadcareFile> {
    return this.client.get<UploadcareFile>(filePath(uuid));
  }

  async store(uuid: string): Promise<UploadcareFile> {
    return this.client.put<UploadcareFile>(`${filePath(uuid)}/storage`);
  }

  async delete(uuid: string): Promise<void> {
    await this.client.delete(`${filePath(uuid)}`);
  }

  async copyLocal(uuid: string, body: Record<string, unknown>): Promise<UploadcareFile> {
    return this.client.post<UploadcareFile>(`${filePath(uuid)}/local_copy`, body);
  }

  async copyRemote(uuid: string, body: Record<string, unknown>): Promise<UploadcareFile> {
    return this.client.post<UploadcareFile>(`${filePath(uuid)}/remote_copy`, body);
  }

  async getMetadata(uuid: string): Promise<Record<string, string>> {
    return this.client.get<Record<string, string>>(`${filePath(uuid)}/metadata`);
  }

  async updateMetadata(uuid: string, metadata: Record<string, string>): Promise<Record<string, string>> {
    return this.client.patch<Record<string, string>>(`${filePath(uuid)}/metadata`, metadata);
  }

  async deleteMetadataKey(uuid: string, key: string): Promise<void> {
    await this.client.delete(`${filePath(uuid)}/metadata/${encodeURIComponent(key)}`);
  }
}
