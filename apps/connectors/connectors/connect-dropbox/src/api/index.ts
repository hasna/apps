import type {
  DropboxConfig,
  FileMetadata,
  FolderMetadata,
  Metadata,
  ListFolderResult,
  SearchV2Result,
  SharedLinkMetadata,
  SharedFolderMetadata,
  ListSharedLinksResult,
  ListFolderMembersResult,
  Account,
  SpaceUsage,
  RelocationResult,
  DeleteResult,
} from '../types';
import { DropboxClient } from './client';
import { BulkApi } from './bulk';

/**
 * Dropbox API wrapper
 */
export class Dropbox {
  private readonly client: DropboxClient;
  public readonly bulk: BulkApi;

  constructor(config: DropboxConfig) {
    this.client = new DropboxClient(config);
    this.bulk = new BulkApi(this.client);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Dropbox {
    const accessToken = process.env.DROPBOX_ACCESS_TOKEN || process.env.DROPBOX_TOKEN;

    if (!accessToken) {
      throw new Error('DROPBOX_ACCESS_TOKEN or DROPBOX_TOKEN environment variable is required');
    }
    return new Dropbox({ accessToken });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): DropboxClient {
    return this.client;
  }

  // ============================================
  // Files API
  // ============================================

  /**
   * Get metadata for a file or folder
   */
  async getMetadata(path: string, params?: {
    include_media_info?: boolean;
    include_deleted?: boolean;
    include_has_explicit_shared_members?: boolean;
    include_property_groups?: 'property_template_ids';
  }): Promise<Metadata> {
    return this.client.post<Metadata>('/files/get_metadata', {
      path,
      ...params,
    });
  }

  /**
   * List folder contents
   */
  async listFolder(path: string, params?: {
    recursive?: boolean;
    include_media_info?: boolean;
    include_deleted?: boolean;
    include_has_explicit_shared_members?: boolean;
    include_mounted_folders?: boolean;
    include_non_downloadable_files?: boolean;
    limit?: number;
  }): Promise<ListFolderResult> {
    return this.client.post<ListFolderResult>('/files/list_folder', {
      path,
      ...params,
    });
  }

  /**
   * Continue listing folder contents
   */
  async listFolderContinue(cursor: string): Promise<ListFolderResult> {
    return this.client.post<ListFolderResult>('/files/list_folder/continue', { cursor });
  }

  /**
   * Create a folder
   */
  async createFolder(path: string, autorename?: boolean): Promise<FolderMetadata> {
    const result = await this.client.post<{ metadata: FolderMetadata }>('/files/create_folder_v2', {
      path,
      autorename: autorename ?? false,
    });
    return result.metadata;
  }

  /**
   * Delete a file or folder
   */
  async delete(path: string): Promise<DeleteResult> {
    return this.client.post<DeleteResult>('/files/delete_v2', { path });
  }

  /**
   * Permanently delete a file or folder
   */
  async permanentlyDelete(path: string): Promise<void> {
    await this.client.post('/files/permanently_delete', { path });
  }

  /**
   * Copy a file or folder
   */
  async copy(fromPath: string, toPath: string, params?: {
    autorename?: boolean;
    allow_shared_folder?: boolean;
    allow_ownership_transfer?: boolean;
  }): Promise<RelocationResult> {
    return this.client.post<RelocationResult>('/files/copy_v2', {
      from_path: fromPath,
      to_path: toPath,
      ...params,
    });
  }

  /**
   * Move a file or folder
   */
  async move(fromPath: string, toPath: string, params?: {
    autorename?: boolean;
    allow_shared_folder?: boolean;
    allow_ownership_transfer?: boolean;
  }): Promise<RelocationResult> {
    return this.client.post<RelocationResult>('/files/move_v2', {
      from_path: fromPath,
      to_path: toPath,
      ...params,
    });
  }

  /**
   * Search for files and folders
   */
  async search(query: string, params?: {
    path?: string;
    max_results?: number;
    file_status?: 'active' | 'deleted';
    filename_only?: boolean;
    file_extensions?: string[];
    file_categories?: Array<'image' | 'document' | 'pdf' | 'spreadsheet' | 'presentation' | 'audio' | 'video' | 'folder' | 'paper' | 'others'>;
  }): Promise<SearchV2Result> {
    return this.client.post<SearchV2Result>('/files/search_v2', {
      query,
      options: params ? {
        path: params.path,
        max_results: params.max_results,
        file_status: params.file_status ? { '.tag': params.file_status } : undefined,
        filename_only: params.filename_only,
        file_extensions: params.file_extensions,
        file_categories: params.file_categories?.map(c => ({ '.tag': c })),
      } : undefined,
    });
  }

  /**
   * Continue search
   */
  async searchContinue(cursor: string): Promise<SearchV2Result> {
    return this.client.post<SearchV2Result>('/files/search/continue_v2', { cursor });
  }

  /**
   * Upload a file (up to 150MB)
   */
  async upload(path: string, content: Uint8Array | string, params?: {
    mode?: 'add' | 'overwrite' | 'update';
    autorename?: boolean;
    mute?: boolean;
    strict_conflict?: boolean;
  }): Promise<FileMetadata> {
    return this.client.uploadRequest<FileMetadata>('/files/upload', content, {
      path,
      mode: params?.mode ? { '.tag': params.mode } : { '.tag': 'add' },
      autorename: params?.autorename ?? false,
      mute: params?.mute ?? false,
      strict_conflict: params?.strict_conflict ?? false,
    });
  }

  /**
   * Download a file
   */
  async download(path: string): Promise<{ content: ArrayBuffer; metadata: FileMetadata }> {
    const result = await this.client.downloadRequest('/files/download', { path });
    return {
      content: result.content,
      metadata: result.metadata as FileMetadata,
    };
  }

  /**
   * Get a temporary link to download a file
   */
  async getTemporaryLink(path: string): Promise<{ link: string; metadata: FileMetadata }> {
    return this.client.post<{ link: string; metadata: FileMetadata }>('/files/get_temporary_link', { path });
  }

  /**
   * Get a preview of a file (PDF, images)
   */
  async getPreview(path: string): Promise<{ content: ArrayBuffer; metadata: FileMetadata }> {
    const result = await this.client.downloadRequest('/files/get_preview', { path });
    return {
      content: result.content,
      metadata: result.metadata as FileMetadata,
    };
  }

  /**
   * Get a thumbnail for an image
   */
  async getThumbnail(path: string, params?: {
    format?: 'jpeg' | 'png';
    size?: 'w32h32' | 'w64h64' | 'w128h128' | 'w256h256' | 'w480h320' | 'w640h480' | 'w960h640' | 'w1024h768' | 'w2048h1536';
    mode?: 'strict' | 'bestfit' | 'fitone_bestfit';
  }): Promise<{ content: ArrayBuffer; metadata: FileMetadata }> {
    const result = await this.client.downloadRequest('/files/get_thumbnail_v2', {
      resource: { '.tag': 'path', path },
      format: params?.format ? { '.tag': params.format } : { '.tag': 'jpeg' },
      size: params?.size ? { '.tag': params.size } : { '.tag': 'w64h64' },
      mode: params?.mode ? { '.tag': params.mode } : { '.tag': 'strict' },
    });
    return {
      content: result.content,
      metadata: result.metadata as FileMetadata,
    };
  }

  // ============================================
  // Sharing API
  // ============================================

  /**
   * Create a shared link
   */
  async createSharedLink(path: string, params?: {
    short_url?: boolean;
    pending_upload?: 'file' | 'folder';
  }): Promise<SharedLinkMetadata> {
    return this.client.post<SharedLinkMetadata>('/sharing/create_shared_link_with_settings', {
      path,
      settings: params,
    });
  }

  /**
   * List shared links
   */
  async listSharedLinks(params?: {
    path?: string;
    cursor?: string;
    direct_only?: boolean;
  }): Promise<ListSharedLinksResult> {
    return this.client.post<ListSharedLinksResult>('/sharing/list_shared_links', params || {});
  }

  /**
   * Get shared link metadata
   */
  async getSharedLinkMetadata(url: string, params?: {
    path?: string;
    link_password?: string;
  }): Promise<SharedLinkMetadata> {
    return this.client.post<SharedLinkMetadata>('/sharing/get_shared_link_metadata', {
      url,
      ...params,
    });
  }

  /**
   * Revoke a shared link
   */
  async revokeSharedLink(url: string): Promise<void> {
    await this.client.post('/sharing/revoke_shared_link', { url });
  }

  /**
   * Share a folder
   */
  async shareFolder(path: string, params?: {
    force_async?: boolean;
    acl_update_policy?: 'owner' | 'editors';
    member_policy?: 'team' | 'anyone';
    shared_link_policy?: 'anyone' | 'team' | 'members';
    viewer_info_policy?: 'enabled' | 'disabled';
  }): Promise<SharedFolderMetadata | { '.tag': 'async_job_id'; async_job_id: string }> {
    const result = await this.client.post<SharedFolderMetadata | { '.tag': 'async_job_id'; async_job_id: string } | { '.tag': 'complete'; complete: SharedFolderMetadata }>('/sharing/share_folder', {
      path,
      ...params,
    });
    if ((result as { '.tag': string })['?tag'] === 'complete') {
      return (result as { '.tag': 'complete'; complete: SharedFolderMetadata }).complete;
    }
    return result as SharedFolderMetadata;
  }

  /**
   * List shared folders
   */
  async listSharedFolders(params?: {
    limit?: number;
    actions?: Array<'change_options' | 'disable_viewer_info' | 'edit_contents' | 'enable_viewer_info' | 'invite_editor' | 'invite_viewer' | 'invite_viewer_no_comment' | 'relinquish_membership' | 'unmount' | 'unshare' | 'leave_a_copy' | 'share_link' | 'create_link' | 'set_access_inheritance'>;
  }): Promise<{ entries: SharedFolderMetadata[]; cursor?: string }> {
    return this.client.post('/sharing/list_folders', params || {});
  }

  /**
   * Get shared folder metadata
   */
  async getSharedFolderMetadata(sharedFolderId: string): Promise<SharedFolderMetadata> {
    return this.client.post<SharedFolderMetadata>('/sharing/get_folder_metadata', {
      shared_folder_id: sharedFolderId,
    });
  }

  /**
   * List shared folder members
   */
  async listSharedFolderMembers(sharedFolderId: string, params?: {
    actions?: string[];
    limit?: number;
  }): Promise<ListFolderMembersResult> {
    return this.client.post<ListFolderMembersResult>('/sharing/list_folder_members', {
      shared_folder_id: sharedFolderId,
      ...params,
    });
  }

  /**
   * Unshare a folder
   */
  async unshareFolder(sharedFolderId: string, leaveACopy?: boolean): Promise<{ '.tag': 'complete' } | { '.tag': 'async_job_id'; async_job_id: string }> {
    return this.client.post('/sharing/unshare_folder', {
      shared_folder_id: sharedFolderId,
      leave_a_copy: leaveACopy ?? false,
    });
  }

  // ============================================
  // Users API
  // ============================================

  /**
   * Get current account
   */
  async getCurrentAccount(): Promise<Account> {
    return this.client.post<Account>('/users/get_current_account', null);
  }

  /**
   * Get space usage
   */
  async getSpaceUsage(): Promise<SpaceUsage> {
    return this.client.post<SpaceUsage>('/users/get_space_usage', null);
  }

  /**
   * Get account by account ID
   */
  async getAccount(accountId: string): Promise<Account> {
    return this.client.post<Account>('/users/get_account', { account_id: accountId });
  }

  /**
   * Get multiple accounts
   */
  async getAccountBatch(accountIds: string[]): Promise<Account[]> {
    return this.client.post<Account[]>('/users/get_account_batch', { account_ids: accountIds });
  }
}

export { DropboxClient } from './client';
export { BulkApi } from './bulk';
