import type { CloudflareClient } from './client';
import type { R2Bucket, R2Object, R2ObjectList, CreateR2BucketParams, ListR2ObjectsParams, CloudflareResponse } from '../types';

export class R2Api {
  constructor(private client: CloudflareClient) {}

  // ============================================
  // Buckets
  // ============================================

  /**
   * List all R2 buckets for an account
   */
  async listBuckets(
    accountId: string,
    params?: {
      cursor?: string;
      per_page?: number;
      name_contains?: string;
      start_after?: string;
      direction?: 'asc' | 'desc';
      order?: 'name';
    }
  ): Promise<CloudflareResponse<{ buckets: R2Bucket[] }>> {
    return this.client.get<{ buckets: R2Bucket[] }>(
      `/accounts/${accountId}/r2/buckets`,
      params
    );
  }

  /**
   * Get bucket details
   */
  async getBucket(accountId: string, bucketName: string): Promise<R2Bucket> {
    const response = await this.client.get<R2Bucket>(
      `/accounts/${accountId}/r2/buckets/${bucketName}`
    );
    return response.result;
  }

  /**
   * Create a new R2 bucket
   */
  async createBucket(accountId: string, params: CreateR2BucketParams): Promise<R2Bucket> {
    const response = await this.client.post<R2Bucket>(
      `/accounts/${accountId}/r2/buckets`,
      params as unknown as Record<string, unknown>
    );
    return response.result;
  }

  /**
   * Delete an R2 bucket
   */
  async deleteBucket(accountId: string, bucketName: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}/r2/buckets/${bucketName}`);
  }

  // ============================================
  // Objects (via S3 API compatibility)
  // Note: Most object operations use S3 API, but these are what's available via Cloudflare API
  // ============================================

  /**
   * List objects in a bucket
   * Note: This is a simplified version. For full S3 compatibility, use the S3 API directly.
   */
  async listObjects(
    accountId: string,
    bucketName: string,
    params?: ListR2ObjectsParams
  ): Promise<R2ObjectList> {
    // R2 object listing via Cloudflare API
    // Note: Full object operations should use S3-compatible endpoint
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.prefix) queryParams.prefix = params.prefix;
    if (params?.delimiter) queryParams.delimiter = params.delimiter;
    if (params?.cursor) queryParams.cursor = params.cursor;
    if (params?.limit) queryParams.limit = params.limit;

    const response = await this.client.get<R2ObjectList>(
      `/accounts/${accountId}/r2/buckets/${bucketName}/objects`,
      queryParams
    );
    return response.result;
  }

  /**
   * Get object metadata
   */
  async getObjectMetadata(
    accountId: string,
    bucketName: string,
    objectKey: string
  ): Promise<R2Object> {
    const response = await this.client.get<R2Object>(
      `/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(objectKey)}`
    );
    return response.result;
  }

  /**
   * Delete an object
   */
  async deleteObject(accountId: string, bucketName: string, objectKey: string): Promise<void> {
    await this.client.delete(
      `/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(objectKey)}`
    );
  }

  // ============================================
  // CORS Configuration
  // ============================================

  /**
   * Get CORS configuration for a bucket
   */
  async getCors(accountId: string, bucketName: string): Promise<{
    rules: Array<{
      allowed_headers?: string[];
      allowed_methods: string[];
      allowed_origins: string[];
      expose_headers?: string[];
      max_age_seconds?: number;
    }>;
  }> {
    const response = await this.client.get<{
      rules: Array<{
        allowed_headers?: string[];
        allowed_methods: string[];
        allowed_origins: string[];
        expose_headers?: string[];
        max_age_seconds?: number;
      }>;
    }>(`/accounts/${accountId}/r2/buckets/${bucketName}/cors`);
    return response.result;
  }

  /**
   * Set CORS configuration for a bucket
   */
  async setCors(
    accountId: string,
    bucketName: string,
    rules: Array<{
      allowed_headers?: string[];
      allowed_methods: string[];
      allowed_origins: string[];
      expose_headers?: string[];
      max_age_seconds?: number;
    }>
  ): Promise<void> {
    await this.client.put(
      `/accounts/${accountId}/r2/buckets/${bucketName}/cors`,
      { rules }
    );
  }

  /**
   * Delete CORS configuration for a bucket
   */
  async deleteCors(accountId: string, bucketName: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}/r2/buckets/${bucketName}/cors`);
  }

  // ============================================
  // Lifecycle Rules
  // ============================================

  /**
   * Get lifecycle rules for a bucket
   */
  async getLifecycle(accountId: string, bucketName: string): Promise<{
    rules: Array<{
      id: string;
      enabled: boolean;
      conditions?: {
        prefix?: string;
      };
      actions?: {
        type: 'Delete' | 'AbortIncompleteMultipartUpload';
        days_after_creation?: number;
      };
    }>;
  }> {
    const response = await this.client.get<{
      rules: Array<{
        id: string;
        enabled: boolean;
        conditions?: {
          prefix?: string;
        };
        actions?: {
          type: 'Delete' | 'AbortIncompleteMultipartUpload';
          days_after_creation?: number;
        };
      }>;
    }>(`/accounts/${accountId}/r2/buckets/${bucketName}/lifecycle`);
    return response.result;
  }

  /**
   * Set lifecycle rules for a bucket
   */
  async setLifecycle(
    accountId: string,
    bucketName: string,
    rules: Array<{
      id: string;
      enabled: boolean;
      conditions?: {
        prefix?: string;
      };
      actions?: {
        type: 'Delete' | 'AbortIncompleteMultipartUpload';
        days_after_creation?: number;
      };
    }>
  ): Promise<void> {
    await this.client.put(
      `/accounts/${accountId}/r2/buckets/${bucketName}/lifecycle`,
      { rules }
    );
  }

  /**
   * Delete lifecycle rules for a bucket
   */
  async deleteLifecycle(accountId: string, bucketName: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}/r2/buckets/${bucketName}/lifecycle`);
  }

  // ============================================
  // Public Access
  // ============================================

  /**
   * Get public access configuration for a bucket
   */
  async getPublicAccess(accountId: string, bucketName: string): Promise<{
    enabled: boolean;
    custom_domain?: string;
  }> {
    const response = await this.client.get<{
      enabled: boolean;
      custom_domain?: string;
    }>(`/accounts/${accountId}/r2/buckets/${bucketName}/public`);
    return response.result;
  }

  /**
   * Enable public access for a bucket
   */
  async enablePublicAccess(accountId: string, bucketName: string): Promise<void> {
    await this.client.put(
      `/accounts/${accountId}/r2/buckets/${bucketName}/public`,
      { enabled: true }
    );
  }

  /**
   * Disable public access for a bucket
   */
  async disablePublicAccess(accountId: string, bucketName: string): Promise<void> {
    await this.client.put(
      `/accounts/${accountId}/r2/buckets/${bucketName}/public`,
      { enabled: false }
    );
  }
}
