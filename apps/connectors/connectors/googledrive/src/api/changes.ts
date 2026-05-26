import type { DriveClient } from './client.ts';
import type { DriveFile } from '../types/index.ts';

// ============================================
// Changes API Types
// ============================================

export interface ListChangesOptions {
  pageToken: string;
  pageSize?: number;
  spaces?: string;
  includeRemoved?: boolean;
  includeItemsFromAllDrives?: boolean;
  restrictToMyDrive?: boolean;
  driveId?: string;
  supportsAllDrives?: boolean;
}

export interface ChangeRecord {
  fileId: string;
  type: 'file' | 'drive' | 'driveMember';
  removed?: boolean;
  file?: DriveFile;
  drive?: {
    id: string;
    name: string;
    kind: string;
  };
  driveMember?: {
    kind: string;
    displayName: string;
    photoLink: string;
  };
}

export interface ListChangesResponse {
  kind: string;
  nextPageToken: string;
  newStartPageToken: string;
  changes: ChangeRecord[];
}

export interface WatchChangesOptions {
  topicName: string;
  params?: Record<string, string>;
  watchType?: string;
  watchId?: string;
  token?: string;
  expiration?: string;
}

export interface WatchResponse {
  kind: string;
  id: string;
  resourceId: string;
  resourceUri: string;
  expiration: string;
}

/**
 * Changes API module - track changes to Drive files and shared drives
 */
export class ChangesApi {
  constructor(private readonly client: DriveClient) {}

  /**
   * Get the starting page token for change tracking
   */
  async getStartPageToken(options: {
    supportsAllDrives?: boolean;
    driveId?: string;
  } = {}): Promise<{ nextPageToken: string }> {
    const params: Record<string, string | boolean | undefined> = {};
    if (options.supportsAllDrives !== undefined) params.supportsAllDrives = options.supportsAllDrives;
    if (options.driveId) params.driveId = options.driveId;

    return this.client.get<{ nextPageToken: string }>('/changes/startPageToken', params);
  }

  /**
   * List changes for a user
   */
  async list(options: ListChangesOptions): Promise<ListChangesResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      pageToken: options.pageToken,
    };
    if (options.pageSize) params.pageSize = options.pageSize;
    if (options.spaces) params.spaces = options.spaces;
    if (options.includeRemoved !== undefined) params.includeRemoved = options.includeRemoved;
    if (options.includeItemsFromAllDrives !== undefined) params.includeItemsFromAllDrives = options.includeItemsFromAllDrives;
    if (options.restrictToMyDrive !== undefined) params.restrictToMyDrive = options.restrictToMyDrive;
    if (options.driveId) params.driveId = options.driveId;
    if (options.supportsAllDrives !== undefined) params.supportsAllDrives = options.supportsAllDrives;

    return this.client.get<ListChangesResponse>('/changes', params);
  }

  /**
   * Iterate over all changes (handles pagination)
   */
  async *listAll(options: Omit<ListChangesOptions, 'pageToken'> & { startPageToken: string }): AsyncGenerator<ChangeRecord> {
    let pageToken = options.startPageToken;
    const baseOptions = { ...options };
    // @ts-expect-error pageToken will be set
    delete baseOptions.pageToken;
    // @ts-expect-error startPageToken is not part of ListChangesOptions
    delete baseOptions.startPageToken;

    do {
      const response = await this.list({ ...baseOptions, pageToken });
      for (const record of response.changes || []) {
        yield record;
      }
      if (response.nextPageToken) {
        pageToken = response.nextPageToken;
      } else {
        break;
      }
    } while (true);
  }

  /**
   * Subscribe to push notifications for changes
   */
  async watch(options: WatchChangesOptions): Promise<WatchResponse> {
    const body: Record<string, unknown> = {
      id: options.watchId,
      type: options.watchType || 'web_hook',
      token: options.token,
      expiration: options.expiration,
    };
    if (options.topicName) {
      body.type = 'web_hook';
      body.params = { topicName: options.topicName, ...(options.params || {}) };
    }

    return this.client.post<WatchResponse>('/changes/watch', body as unknown as Record<string, unknown>);
  }
}
