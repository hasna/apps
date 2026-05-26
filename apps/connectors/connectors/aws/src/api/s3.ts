import type { AWSClient } from './client';
import type {
  S3Bucket,
  S3Object,
  S3ListObjectsResponse,
  S3PutObjectRequest,
  S3GetObjectResponse,
  S3HeadObjectResponse,
} from '../types';

/**
 * S3 API client
 */
export class S3Api {
  private readonly client: AWSClient;

  constructor(client: AWSClient) {
    this.client = client;
  }

  /**
   * List all S3 buckets
   */
  async listBuckets(): Promise<S3Bucket[]> {
    const response = await this.client.request<string>('/', {
      service: 's3',
      region: 'us-east-1', // ListBuckets uses global endpoint
      headers: {
        'Content-Type': 'application/xml',
      },
    });

    // Parse XML response
    const buckets: S3Bucket[] = [];
    const bucketMatches = response.matchAll(/<Bucket>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?(?:<CreationDate>([^<]+)<\/CreationDate>)?[\s\S]*?<\/Bucket>/g);

    for (const match of bucketMatches) {
      buckets.push({
        name: match[1],
        creationDate: match[2],
      });
    }

    return buckets;
  }

  /**
   * List objects in a bucket
   */
  async listObjects(
    bucket: string,
    options?: {
      prefix?: string;
      delimiter?: string;
      maxKeys?: number;
      continuationToken?: string;
    }
  ): Promise<S3ListObjectsResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      'list-type': 2,
      prefix: options?.prefix,
      delimiter: options?.delimiter,
      'max-keys': options?.maxKeys,
      'continuation-token': options?.continuationToken,
    };

    const response = await this.client.request<string>(`/${bucket}`, {
      service: 's3',
      params,
      headers: {
        'Content-Type': 'application/xml',
      },
    });

    // Parse XML response
    const result: S3ListObjectsResponse = {
      name: bucket,
      contents: [],
      isTruncated: false,
    };

    // Parse bucket name
    const nameMatch = response.match(/<Name>([^<]+)<\/Name>/);
    if (nameMatch) result.name = nameMatch[1];

    // Parse prefix
    const prefixMatch = response.match(/<Prefix>([^<]*)<\/Prefix>/);
    if (prefixMatch) result.prefix = prefixMatch[1];

    // Parse truncation
    const truncatedMatch = response.match(/<IsTruncated>([^<]+)<\/IsTruncated>/);
    if (truncatedMatch) result.isTruncated = truncatedMatch[1] === 'true';

    // Parse next continuation token
    const tokenMatch = response.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (tokenMatch) result.nextContinuationToken = tokenMatch[1];

    // Parse key count
    const keyCountMatch = response.match(/<KeyCount>([^<]+)<\/KeyCount>/);
    if (keyCountMatch) result.keyCount = parseInt(keyCountMatch[1]);

    // Parse objects
    const objectMatches = response.matchAll(/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?(?:<LastModified>([^<]+)<\/LastModified>)?[\s\S]*?(?:<ETag>([^<]+)<\/ETag>)?[\s\S]*?(?:<Size>([^<]+)<\/Size>)?[\s\S]*?(?:<StorageClass>([^<]+)<\/StorageClass>)?[\s\S]*?<\/Contents>/g);

    for (const match of objectMatches) {
      result.contents.push({
        key: match[1],
        lastModified: match[2],
        eTag: match[3]?.replace(/"/g, ''),
        size: match[4] ? parseInt(match[4]) : undefined,
        storageClass: match[5],
      });
    }

    // Parse common prefixes
    const prefixMatches = response.matchAll(/<CommonPrefixes>[\s\S]*?<Prefix>([^<]+)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g);
    const commonPrefixes: { prefix: string }[] = [];
    for (const match of prefixMatches) {
      commonPrefixes.push({ prefix: match[1] });
    }
    if (commonPrefixes.length > 0) {
      result.commonPrefixes = commonPrefixes;
    }

    return result;
  }

  /**
   * Get object metadata (HEAD)
   */
  async headObject(bucket: string, key: string): Promise<S3HeadObjectResponse> {
    const response = await this.client.requestRaw(`/${bucket}/${encodeURIComponent(key)}`, {
      method: 'HEAD',
      service: 's3',
    });

    return {
      contentType: response.headers.get('content-type') || undefined,
      contentLength: response.headers.get('content-length') ? parseInt(response.headers.get('content-length')!) : undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      eTag: response.headers.get('etag')?.replace(/"/g, '') || undefined,
      metadata: this.parseMetadataHeaders(response.headers),
    };
  }

  /**
   * Get an object from S3
   */
  async getObject(bucket: string, key: string): Promise<S3GetObjectResponse> {
    const response = await this.client.requestRaw(`/${bucket}/${encodeURIComponent(key)}`, {
      method: 'GET',
      service: 's3',
    });

    return {
      body: response.data,
      contentType: response.headers.get('content-type') || undefined,
      contentLength: response.headers.get('content-length') ? parseInt(response.headers.get('content-length')!) : undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      eTag: response.headers.get('etag')?.replace(/"/g, '') || undefined,
      metadata: this.parseMetadataHeaders(response.headers),
    };
  }

  /**
   * Put an object to S3
   */
  async putObject(request: S3PutObjectRequest): Promise<{ eTag?: string; versionId?: string }> {
    const body = typeof request.body === 'string'
      ? new TextEncoder().encode(request.body)
      : request.body;

    const headers: Record<string, string> = {};

    if (request.contentType) {
      headers['Content-Type'] = request.contentType;
    }

    if (request.acl) {
      headers['x-amz-acl'] = request.acl;
    }

    if (request.metadata) {
      for (const [key, value] of Object.entries(request.metadata)) {
        headers[`x-amz-meta-${key}`] = value;
      }
    }

    const response = await this.client.requestRaw(
      `/${request.bucket}/${encodeURIComponent(request.key)}`,
      {
        method: 'PUT',
        service: 's3',
        body,
        headers,
      }
    );

    return {
      eTag: response.headers.get('etag')?.replace(/"/g, '') || undefined,
      versionId: response.headers.get('x-amz-version-id') || undefined,
    };
  }

  /**
   * Delete an object from S3
   */
  async deleteObject(bucket: string, key: string): Promise<{ versionId?: string; deleteMarker?: boolean }> {
    const response = await this.client.requestRaw(`/${bucket}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      service: 's3',
    });

    return {
      versionId: response.headers.get('x-amz-version-id') || undefined,
      deleteMarker: response.headers.get('x-amz-delete-marker') === 'true',
    };
  }

  /**
   * Generate a presigned URL for an object
   * Note: This is a simplified version - for production use, consider using AWS SDK
   */
  async getSignedUrl(
    bucket: string,
    key: string,
    options?: {
      expiresIn?: number; // seconds, default 3600
      method?: 'GET' | 'PUT';
    }
  ): Promise<string> {
    const expiresIn = options?.expiresIn || 3600;
    const method = options?.method || 'GET';

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const region = this.client.getRegion();
    const service = 's3';

    const credential = `${this.getAccessKeyId()}/${dateStamp}/${region}/${service}/aws4_request`;

    const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`);
    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', credential);
    url.searchParams.set('X-Amz-Date', amzDate);
    url.searchParams.set('X-Amz-Expires', String(expiresIn));
    url.searchParams.set('X-Amz-SignedHeaders', 'host');

    // For a complete implementation, you'd need to compute the signature
    // This is a simplified version that shows the URL structure
    // In production, use the AWS SDK for proper presigned URLs

    return url.toString();
  }

  /**
   * Copy an object within S3
   */
  async copyObject(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<{ eTag?: string; lastModified?: string }> {
    const response = await this.client.request<string>(
      `/${destBucket}/${encodeURIComponent(destKey)}`,
      {
        method: 'PUT',
        service: 's3',
        headers: {
          'x-amz-copy-source': `/${sourceBucket}/${encodeURIComponent(sourceKey)}`,
        },
      }
    );

    const eTagMatch = response.match(/<ETag>([^<]+)<\/ETag>/);
    const lastModifiedMatch = response.match(/<LastModified>([^<]+)<\/LastModified>/);

    return {
      eTag: eTagMatch?.[1]?.replace(/"/g, ''),
      lastModified: lastModifiedMatch?.[1],
    };
  }

  /**
   * Parse metadata headers from response
   */
  private parseMetadataHeaders(headers: Headers): Record<string, string> | undefined {
    const metadata: Record<string, string> = {};
    headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith('x-amz-meta-')) {
        metadata[key.substring(11)] = value;
      }
    });
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * Get access key ID (for presigned URLs)
   */
  private getAccessKeyId(): string {
    return this.client.getAccessKeyPreview().replace(/\.\.\./g, 'XXXX');
  }
}
