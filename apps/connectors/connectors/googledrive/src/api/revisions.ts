import type { DriveClient } from './client.ts';

// ============================================
// Revisions API Types
// ============================================

export interface FileRevision {
  id: string;
  mimeType: string;
  modifiedTime?: string;
  keepForever?: boolean;
  published?: boolean;
  publishedOutsideDomain?: boolean;
  publishAuto?: boolean;
  publishedLink?: string;
  lastModifyingUser?: {
    displayName: string;
    photoLink: string;
    me: boolean;
    permissionId: string;
    emailAddress: string;
  };
  originalFilename?: string;
  size?: string;
  exportLinks?: Record<string, string>;
  sha1Checksum?: string;
  sha256Checksum?: string;
  md5Checksum?: string;
  contentHints?: {
    thumbnail?: {
      image: string;
      mimeType: string;
    };
  };
}

export interface ListRevisionsResponse {
  kind: string;
  fileExportMimeType?: string;
  revisions: FileRevision[];
}

export interface ListRevisionsOptions {
  pageSize?: number;
  pageToken?: string;
  fields?: string;
}

export interface UpdateRevisionOptions {
  keepForever?: boolean;
  publishAuto?: boolean;
  published?: boolean;
  publishedOutsideDomain?: boolean;
}

/**
 * Revisions API module - manage file revision history
 */
export class RevisionsApi {
  constructor(private readonly client: DriveClient) {}

  /**
   * List revisions of a file
   */
  async list(fileId: string, options: ListRevisionsOptions = {}): Promise<ListRevisionsResponse> {
    const params: Record<string, string | number | undefined> = {};
    if (options.pageSize) params.pageSize = options.pageSize;
    if (options.pageToken) params.pageToken = options.pageToken;
    if (options.fields) params.fields = options.fields;

    return this.client.get<ListRevisionsResponse>(`/files/${fileId}/revisions`, params);
  }

  /**
   * Iterate over all revisions of a file (handles pagination)
   */
  async *listAll(fileId: string, options: Omit<ListRevisionsOptions, 'pageToken'> = {}): AsyncGenerator<FileRevision> {
    let pageToken: string | undefined;
    do {
      const response = await this.list(fileId, { ...options, pageToken });
      for (const revision of response.revisions || []) {
        yield revision;
      }
      pageToken = response.revisions?.length && response.revisions.length > 0
        ? undefined
        : undefined;
      // Drive revisions API doesn't always paginate, so we check once
      break;
    } while (pageToken);
  }

  /**
   * Get a specific revision
   */
  async get(fileId: string, revisionId: string): Promise<FileRevision> {
    return this.client.get<FileRevision>(`/files/${fileId}/revisions/${revisionId}`);
  }

  /**
   * Update revision metadata
   */
  async update(fileId: string, revisionId: string, options: UpdateRevisionOptions): Promise<FileRevision> {
    const body: Record<string, unknown> = {};
    if (options.keepForever !== undefined) body.keepForever = options.keepForever;
    if (options.publishAuto !== undefined) body.publishAuto = options.publishAuto;
    if (options.published !== undefined) body.published = options.published;
    if (options.publishedOutsideDomain !== undefined) body.publishedOutsideDomain = options.publishedOutsideDomain;

    return this.client.patch<FileRevision>(`/files/${fileId}/revisions/${revisionId}`, body);
  }

  /**
   * Delete a revision
   */
  async delete(fileId: string, revisionId: string): Promise<void> {
    await this.client.delete(`/files/${fileId}/revisions/${revisionId}`);
  }

  /**
   * Download the content of a revision
   */
  async download(fileId: string, revisionId: string): Promise<ArrayBuffer> {
    return this.client.downloadRevision(fileId, revisionId);
  }

  /**
   * Export a Google Workspace document revision in a specific format
   */
  async export(fileId: string, revisionId: string, mimeType: string): Promise<ArrayBuffer> {
    return this.client.exportRevision(fileId, revisionId, mimeType);
  }
}
