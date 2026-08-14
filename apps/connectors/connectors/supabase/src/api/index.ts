import type {
  SupabaseConfig,
  User,
  Session,
  AuthResponse,
  AdminUserAttributes,
  ListUsersResult,
  Factor,
  Bucket,
  FileObject,
  SignedUrl,
  EdgeFunction,
} from '../types';
import { SupabaseClient } from './client';

/**
 * Supabase API wrapper
 */
export class Supabase {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = new SupabaseClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Supabase {
    const projectUrl = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (!projectUrl) {
      throw new Error('SUPABASE_URL environment variable is required');
    }
    if (!serviceRoleKey && !anonKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variable is required');
    }
    return new Supabase({ projectUrl, serviceRoleKey, anonKey });
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
  getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Get project URL
   */
  getProjectUrl(): string {
    return this.client.getProjectUrl();
  }

  // ============================================
  // Auth Admin API
  // ============================================

  /**
   * List all users (admin only)
   */
  async listUsers(params?: {
    page?: number;
    per_page?: number;
  }): Promise<ListUsersResult> {
    return this.client.get<ListUsersResult>('/admin/users', params, 'auth');
  }

  /**
   * Get user by ID (admin only)
   */
  async getUserById(userId: string): Promise<User> {
    return this.client.get<User>(`/admin/users/${userId}`, undefined, 'auth');
  }

  /**
   * Create user (admin only)
   */
  async createUser(params: {
    email?: string;
    phone?: string;
    password?: string;
    email_confirm?: boolean;
    phone_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
    ban_duration?: string;
  }): Promise<User> {
    return this.client.post<User>('/admin/users', params, 'auth');
  }

  /**
   * Update user (admin only)
   */
  async updateUser(userId: string, attributes: AdminUserAttributes): Promise<User> {
    return this.client.put<User>(`/admin/users/${userId}`, attributes, 'auth');
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(userId: string): Promise<void> {
    await this.client.delete(`/admin/users/${userId}`, undefined, 'auth');
  }

  /**
   * Invite user by email (admin only)
   */
  async inviteUserByEmail(email: string, options?: {
    redirect_to?: string;
    data?: Record<string, unknown>;
  }): Promise<User> {
    return this.client.post<User>('/admin/invite', { email, ...options }, 'auth');
  }

  /**
   * Generate link for user (admin only)
   */
  async generateLink(params: {
    type: 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change_current' | 'email_change_new';
    email: string;
    password?: string;
    new_email?: string;
    redirect_to?: string;
    data?: Record<string, unknown>;
  }): Promise<{ action_link: string; email_otp?: string; hashed_token?: string; redirect_to?: string; verification_type?: string }> {
    return this.client.post('/admin/generate_link', params, 'auth');
  }

  /**
   * List user's MFA factors (admin only)
   */
  async listUserFactors(userId: string): Promise<Factor[]> {
    return this.client.get<Factor[]>(`/admin/users/${userId}/factors`, undefined, 'auth');
  }

  /**
   * Delete user's MFA factor (admin only)
   */
  async deleteUserFactor(userId: string, factorId: string): Promise<void> {
    await this.client.delete(`/admin/users/${userId}/factors/${factorId}`, undefined, 'auth');
  }

  // ============================================
  // Storage API
  // ============================================

  /**
   * List all buckets
   */
  async listBuckets(): Promise<Bucket[]> {
    return this.client.get<Bucket[]>('/bucket', undefined, 'storage');
  }

  /**
   * Get bucket by ID
   */
  async getBucket(bucketId: string): Promise<Bucket> {
    return this.client.get<Bucket>(`/bucket/${bucketId}`, undefined, 'storage');
  }

  /**
   * Create bucket
   */
  async createBucket(params: {
    id?: string;
    name: string;
    public?: boolean;
    file_size_limit?: number;
    allowed_mime_types?: string[];
  }): Promise<{ name: string }> {
    return this.client.post<{ name: string }>('/bucket', params, 'storage');
  }

  /**
   * Update bucket
   */
  async updateBucket(bucketId: string, params: {
    public?: boolean;
    file_size_limit?: number;
    allowed_mime_types?: string[];
  }): Promise<{ message: string }> {
    return this.client.put<{ message: string }>(`/bucket/${bucketId}`, params, 'storage');
  }

  /**
   * Delete bucket (must be empty)
   */
  async deleteBucket(bucketId: string): Promise<{ message: string }> {
    return this.client.delete<{ message: string }>(`/bucket/${bucketId}`, undefined, 'storage');
  }

  /**
   * Empty bucket (delete all files)
   */
  async emptyBucket(bucketId: string): Promise<{ message: string }> {
    return this.client.post<{ message: string }>(`/bucket/${bucketId}/empty`, {}, 'storage');
  }

  /**
   * List files in bucket
   */
  async listFiles(bucket: string, params?: {
    prefix?: string;
    limit?: number;
    offset?: number;
    sortBy?: { column: string; order: 'asc' | 'desc' };
    search?: string;
  }): Promise<FileObject[]> {
    return this.client.post<FileObject[]>(`/object/list/${bucket}`, params || {}, 'storage');
  }

  /**
   * Upload file
   */
  async uploadFile(bucket: string, path: string, content: ArrayBuffer | Uint8Array, contentType?: string): Promise<{ Key: string }> {
    const arrayBuffer = content instanceof Uint8Array ? content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) : content;
    return this.client.uploadFile(bucket, path, arrayBuffer, contentType);
  }

  /**
   * Download file
   */
  async downloadFile(bucket: string, path: string): Promise<ArrayBuffer> {
    return this.client.downloadFile(bucket, path);
  }

  /**
   * Move/rename file
   */
  async moveFile(bucket: string, fromPath: string, toPath: string): Promise<{ message: string }> {
    return this.client.post<{ message: string }>(`/object/move`, {
      bucketId: bucket,
      sourceKey: fromPath,
      destinationKey: toPath,
    }, 'storage');
  }

  /**
   * Copy file
   */
  async copyFile(bucket: string, fromPath: string, toPath: string): Promise<{ Key: string }> {
    return this.client.post<{ Key: string }>(`/object/copy`, {
      bucketId: bucket,
      sourceKey: fromPath,
      destinationKey: toPath,
    }, 'storage');
  }

  /**
   * Delete files
   */
  async deleteFiles(bucket: string, paths: string[]): Promise<{ name: string }[]> {
    return this.client.delete<{ name: string }[]>(`/object/${bucket}`, { prefixes: paths.join(',') }, 'storage');
  }

  /**
   * Create signed URL for download
   */
  async createSignedUrl(bucket: string, path: string, expiresIn: number = 3600): Promise<SignedUrl> {
    return this.client.post<SignedUrl>(`/object/sign/${bucket}/${path}`, { expiresIn }, 'storage');
  }

  /**
   * Create signed URLs for multiple files
   */
  async createSignedUrls(bucket: string, paths: string[], expiresIn: number = 3600): Promise<SignedUrl[]> {
    return this.client.post<SignedUrl[]>(`/object/sign/${bucket}`, { paths, expiresIn }, 'storage');
  }

  /**
   * Get public URL for file (bucket must be public)
   */
  getPublicUrl(bucket: string, path: string): string {
    return `${this.client.getProjectUrl()}/storage/v1/object/public/${bucket}/${path}`;
  }

  // ============================================
  // Database REST API (PostgREST)
  // ============================================

  /**
   * Select records from a table
   */
  async select<T = unknown>(table: string, params?: {
    select?: string;
    filter?: Record<string, string>;
    order?: string;
    limit?: number;
    offset?: number;
    single?: boolean;
  }): Promise<T[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params?.select) {
      queryParams.select = params.select;
    }
    if (params?.filter) {
      Object.entries(params.filter).forEach(([key, value]) => {
        queryParams[key] = value;
      });
    }
    if (params?.order) {
      queryParams.order = params.order;
    }
    if (params?.limit) {
      queryParams.limit = params.limit;
    }
    if (params?.offset) {
      queryParams.offset = params.offset;
    }

    const headers: Record<string, string> = {};
    if (params?.single) {
      headers['Accept'] = 'application/vnd.pgrst.object+json';
    }

    return this.client.request<T[]>(`/${table}`, {
      method: 'GET',
      params: queryParams,
      headers,
      apiType: 'rest',
    });
  }

  /**
   * Insert records into a table
   */
  async insert<T = unknown>(table: string, data: Record<string, unknown> | Record<string, unknown>[], options?: {
    returning?: 'minimal' | 'representation';
    onConflict?: string;
    ignoreDuplicates?: boolean;
  }): Promise<T[]> {
    const headers: Record<string, string> = {};

    if (options?.returning === 'minimal') {
      headers['Prefer'] = 'return=minimal';
    } else {
      headers['Prefer'] = 'return=representation';
    }

    if (options?.onConflict) {
      headers['Prefer'] = `${headers['Prefer'] || ''},resolution=merge-duplicates`;
    }

    if (options?.ignoreDuplicates) {
      headers['Prefer'] = `${headers['Prefer'] || ''},resolution=ignore-duplicates`;
    }

    return this.client.request<T[]>(`/${table}`, {
      method: 'POST',
      body: data,
      headers,
      apiType: 'rest',
    });
  }

  /**
   * Update records in a table
   */
  async update<T = unknown>(table: string, data: Record<string, unknown>, filter: Record<string, string>, options?: {
    returning?: 'minimal' | 'representation';
  }): Promise<T[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = { ...filter };

    const headers: Record<string, string> = {};
    if (options?.returning === 'minimal') {
      headers['Prefer'] = 'return=minimal';
    } else {
      headers['Prefer'] = 'return=representation';
    }

    return this.client.request<T[]>(`/${table}`, {
      method: 'PATCH',
      body: data,
      params: queryParams,
      headers,
      apiType: 'rest',
    });
  }

  /**
   * Delete records from a table
   */
  async deleteRecords<T = unknown>(table: string, filter: Record<string, string>, options?: {
    returning?: 'minimal' | 'representation';
  }): Promise<T[]> {
    const headers: Record<string, string> = {};
    if (options?.returning === 'minimal') {
      headers['Prefer'] = 'return=minimal';
    } else {
      headers['Prefer'] = 'return=representation';
    }

    return this.client.request<T[]>(`/${table}`, {
      method: 'DELETE',
      params: filter,
      headers,
      apiType: 'rest',
    });
  }

  /**
   * Call RPC function
   */
  async rpc<T = unknown>(functionName: string, params?: Record<string, unknown>): Promise<T> {
    return this.client.post<T>(`/rpc/${functionName}`, params || {}, 'rest');
  }

  // ============================================
  // Edge Functions API
  // ============================================

  /**
   * Invoke an edge function
   */
  async invokeFunction<T = unknown>(functionName: string, options?: {
    body?: Record<string, unknown> | string;
    headers?: Record<string, string>;
  }): Promise<T> {
    return this.client.request<T>(`/${functionName}`, {
      method: 'POST',
      body: options?.body as Record<string, unknown>,
      headers: options?.headers,
      apiType: 'functions',
    });
  }
}

export { SupabaseClient } from './client';
