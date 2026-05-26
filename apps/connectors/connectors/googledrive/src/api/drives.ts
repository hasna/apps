import type { DriveClient } from './client.ts';

export interface SharedDrive {
  id: string;
  name: string;
  kind: string;
  colorRgb?: string;
  backgroundImageFile?: {
    id: string;
    xCoordinate: number;
    yCoordinate: number;
    width: number;
  };
  backgroundImageLink?: string;
  capabilities?: {
    canAddChildren: boolean;
    canChangeCopyRequiresWriterPermissionRestriction: boolean;
    canChangeDomainUsersOnlyRestriction: boolean;
    canChangeDriveBackground: boolean;
    canChangeDriveMembersOnlyRestriction: boolean;
    canComment: boolean;
    canCopy: boolean;
    canDeleteChildren: boolean;
    canDeleteDrive: boolean;
    canDownload: boolean;
    canEdit: boolean;
    canListChildren: boolean;
    canManageMembers: boolean;
    canReadRevisions: boolean;
    canRename: boolean;
    canRenameDrive: boolean;
    canShare: boolean;
    canTrashChildren: boolean;
  };
  themeId?: string;
  restrictions?: {
    adminManagedRestrictions: boolean;
    copyRequiresWriterPermission: boolean;
    domainUsersOnly: boolean;
    driveMembersOnly: boolean;
  };
  createdTime?: string;
  hidden?: boolean;
  orgUnitId?: string;
}

export interface SharedDriveListResponse {
  kind: string;
  nextPageToken?: string;
  drives: SharedDrive[];
}

export interface ListSharedDrivesOptions {
  pageSize?: number;
  pageToken?: string;
  q?: string;
  useDomainAdminAccess?: boolean;
}

export interface CreateSharedDriveOptions {
  name: string;
  themeId?: string;
  colorRgb?: string;
  restrictions?: {
    adminManagedRestrictions?: boolean;
    copyRequiresWriterPermission?: boolean;
    domainUsersOnly?: boolean;
    driveMembersOnly?: boolean;
  };
}

export class DrivesApi {
  constructor(private client: DriveClient) {}

  /**
   * List all shared drives the user has access to
   */
  async list(options: ListSharedDrivesOptions = {}): Promise<SharedDriveListResponse> {
    return this.client.get<SharedDriveListResponse>('/drives', {
      pageSize: options.pageSize || 100,
      pageToken: options.pageToken,
      q: options.q,
      useDomainAdminAccess: options.useDomainAdminAccess,
    });
  }

  /**
   * Get a shared drive by ID
   */
  async get(driveId: string, useDomainAdminAccess = false): Promise<SharedDrive> {
    return this.client.get<SharedDrive>('/drives/' + driveId, {
      useDomainAdminAccess,
    });
  }

  /**
   * Create a new shared drive
   */
  async create(options: CreateSharedDriveOptions): Promise<SharedDrive> {
    // Generate a unique request ID for idempotency
    const requestId = crypto.randomUUID();

    const metadata: Record<string, unknown> = {
      name: options.name,
    };

    if (options.themeId) {
      metadata.themeId = options.themeId;
    }
    if (options.colorRgb) {
      metadata.colorRgb = options.colorRgb;
    }
    if (options.restrictions) {
      metadata.restrictions = options.restrictions;
    }

    return this.client.post<SharedDrive>('/drives', metadata, {
      requestId,
    });
  }

  /**
   * Update a shared drive
   */
  async update(driveId: string, updates: Partial<Pick<SharedDrive, 'name' | 'colorRgb' | 'themeId' | 'restrictions'>>): Promise<SharedDrive> {
    return this.client.patch<SharedDrive>('/drives/' + driveId, updates as Record<string, unknown>, {
      useDomainAdminAccess: false,
    });
  }

  /**
   * Delete a shared drive (must be empty)
   */
  async delete(driveId: string, useDomainAdminAccess = false): Promise<void> {
    await this.client.delete('/drives/' + driveId, {
      useDomainAdminAccess,
      allowItemDeletion: false,
    });
  }

  /**
   * Hide a shared drive
   */
  async hide(driveId: string): Promise<SharedDrive> {
    return this.client.post<SharedDrive>('/drives/' + driveId + '/hide', {});
  }

  /**
   * Unhide a shared drive
   */
  async unhide(driveId: string): Promise<SharedDrive> {
    return this.client.post<SharedDrive>('/drives/' + driveId + '/unhide', {});
  }

  /**
   * List files in a shared drive
   */
  async listFiles(driveId: string, options: { pageSize?: number; pageToken?: string; q?: string } = {}): Promise<{
    files: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      createdTime: string;
      modifiedTime: string;
      parents?: string[];
    }>;
    nextPageToken?: string;
  }> {
    let q = "trashed = false";
    if (options.q) {
      q += " and " + options.q;
    }

    return this.client.get('/files', {
      driveId,
      corpora: 'drive',
      q,
      pageSize: options.pageSize || 100,
      pageToken: options.pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink)',
    });
  }
}
