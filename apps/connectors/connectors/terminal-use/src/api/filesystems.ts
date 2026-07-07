import type {
  CreateFilesystemParams,
  FilesystemUrlParams,
  ListFilesystemsParams,
  ListFilesParams,
} from '../types';
import { normalizeQueryParams, omitUndefined, pickArg } from '../types';
import type { ConnectorClient } from './client';

export class FilesystemsApi {
  constructor(private readonly client: ConnectorClient) {}

  create(params: CreateFilesystemParams): Promise<unknown> {
    const body = omitUndefined({
      project_id: pickArg<string>(params as Record<string, unknown>, 'project_id', 'projectId'),
      name: params.name,
    });

    return this.client.post('/filesystems', body);
  }

  list(params: ListFilesystemsParams = {}): Promise<unknown> {
    return this.client.get('/filesystems', normalizeQueryParams(params as Record<string, unknown>));
  }

  get(filesystemId: string): Promise<unknown> {
    if (!filesystemId) {
      throw new Error('filesystem_id is required');
    }
    return this.client.get(`/filesystems/${encodeURIComponent(filesystemId)}`);
  }

  listFiles(filesystemId: string, params: ListFilesParams = {}): Promise<unknown> {
    if (!filesystemId) {
      throw new Error('filesystem_id is required');
    }
    return this.client.get(
      `/filesystems/${encodeURIComponent(filesystemId)}/files`,
      normalizeQueryParams(params as Record<string, unknown>)
    );
  }

  getFile(filesystemId: string, filePath: string): Promise<unknown> {
    if (!filesystemId || !filePath) {
      throw new Error('filesystem_id and file_path are required');
    }
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    return this.client.get(`/filesystems/${encodeURIComponent(filesystemId)}/files/${encodedPath}`);
  }

  getUploadUrl(filesystemId: string, params: FilesystemUrlParams = {}): Promise<unknown> {
    return this.postFilesystemAction(filesystemId, 'upload-url', params);
  }

  getDownloadUrl(filesystemId: string, params: FilesystemUrlParams = {}): Promise<unknown> {
    return this.postFilesystemAction(filesystemId, 'download-url', params);
  }

  syncComplete(filesystemId: string, params: FilesystemUrlParams = {}): Promise<unknown> {
    return this.postFilesystemAction(filesystemId, 'sync-complete', params);
  }

  private postFilesystemAction(
    filesystemId: string,
    action: 'upload-url' | 'download-url' | 'sync-complete',
    params: FilesystemUrlParams
  ): Promise<unknown> {
    if (!filesystemId) {
      throw new Error('filesystem_id is required');
    }

    const body = omitUndefined({
      path: pickArg<string>(params as Record<string, unknown>, 'path', 'file_path', 'filePath'),
      file_path: pickArg<string>(params as Record<string, unknown>, 'file_path', 'filePath', 'path'),
      content_type: pickArg<string>(params as Record<string, unknown>, 'content_type', 'contentType'),
      ...omitUndefined(
        Object.fromEntries(
          Object.entries(params).filter(([key]) =>
            !['path', 'file_path', 'filePath', 'content_type', 'contentType'].includes(key)
          )
        )
      ),
    });

    return this.client.post(`/filesystems/${encodeURIComponent(filesystemId)}/${action}`, body);
  }
}
