import type { AWSConfig } from '../types';
import { AWSApiError } from '../types';

// AWS Service endpoints
const SERVICE_ENDPOINTS: Record<string, string> = {
  s3: 's3.{region}.amazonaws.com',
  lambda: 'lambda.{region}.amazonaws.com',
  dynamodb: 'dynamodb.{region}.amazonaws.com',
};

export interface AWSRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  params?: Record<string, string | number | boolean | undefined>;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  service: string;
  region?: string;
}

/**
 * AWS API Client with Signature V4 signing
 */
export class AWSClient {
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly region: string;
  private readonly sessionToken?: string;

  constructor(config: AWSConfig) {
    if (!config.accessKeyId) {
      throw new Error('AWS Access Key ID is required');
    }
    if (!config.secretAccessKey) {
      throw new Error('AWS Secret Access Key is required');
    }
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region = config.region || 'us-east-1';
    this.sessionToken = config.sessionToken;
  }

  /**
   * Get the endpoint for a service
   */
  getEndpoint(service: string, region?: string): string {
    const endpoint = SERVICE_ENDPOINTS[service];
    if (!endpoint) {
      throw new Error(`Unknown service: ${service}`);
    }
    return endpoint.replace('{region}', region || this.region);
  }

  /**
   * Create HMAC-SHA256 signature
   */
  private async hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key.buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
    return new Uint8Array(signature);
  }

  /**
   * Create SHA-256 hash
   */
  private async sha256(message: string | Uint8Array): Promise<string> {
    const data = typeof message === 'string' ? new TextEncoder().encode(message) : message;
    const hash = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    return this.toHex(new Uint8Array(hash));
  }

  /**
   * Convert bytes to hex string
   */
  private toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Get AWS Signature V4 signing key
   */
  private async getSigningKey(dateStamp: string, region: string, service: string): Promise<Uint8Array> {
    const kDate = await this.hmacSha256(
      new TextEncoder().encode(`AWS4${this.secretAccessKey}`),
      dateStamp
    );
    const kRegion = await this.hmacSha256(kDate, region);
    const kService = await this.hmacSha256(kRegion, service);
    return this.hmacSha256(kService, 'aws4_request');
  }

  /**
   * Sign a request using AWS Signature V4
   */
  async signRequest(
    method: string,
    url: URL,
    headers: Record<string, string>,
    body: string | Uint8Array | undefined,
    service: string,
    region: string
  ): Promise<Record<string, string>> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    // Prepare payload hash
    const payloadHash = body ? await this.sha256(body) : await this.sha256('');

    // Prepare headers
    const signedHeaders: Record<string, string> = {
      ...headers,
      host: url.host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    };

    if (this.sessionToken) {
      signedHeaders['x-amz-security-token'] = this.sessionToken;
    }

    // Sort headers
    const sortedHeaderKeys = Object.keys(signedHeaders).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    const signedHeadersString = sortedHeaderKeys.map(k => k.toLowerCase()).join(';');

    // Create canonical headers
    const canonicalHeaders = sortedHeaderKeys
      .map(k => `${k.toLowerCase()}:${signedHeaders[k].trim()}`)
      .join('\n') + '\n';

    // Create canonical URI (path must be URI encoded)
    const canonicalUri = url.pathname || '/';

    // Create canonical query string
    const params = new URLSearchParams(url.search);
    const sortedParams = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQueryString = sortedParams
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    // Create canonical request
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeadersString,
      payloadHash,
    ].join('\n');

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      await this.sha256(canonicalRequest),
    ].join('\n');

    // Get signing key and create signature
    const signingKey = await this.getSigningKey(dateStamp, region, service);
    const signatureBytes = await this.hmacSha256(signingKey, stringToSign);
    const signature = this.toHex(signatureBytes);

    // Create authorization header
    const authorizationHeader = [
      `${algorithm} Credential=${this.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeadersString}`,
      `Signature=${signature}`,
    ].join(', ');

    return {
      ...signedHeaders,
      Authorization: authorizationHeader,
    };
  }

  /**
   * Make a signed request to an AWS service
   */
  async request<T>(
    path: string,
    options: AWSRequestOptions
  ): Promise<T> {
    const { method = 'GET', params, body, headers = {}, service, region = this.region } = options;

    const endpoint = this.getEndpoint(service, region);
    const url = new URL(`https://${endpoint}${path}`);

    // Add query params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Sign the request
    const signedHeaders = await this.signRequest(
      method,
      url,
      headers,
      body,
      service,
      region
    );

    const fetchBody = body instanceof Uint8Array ? body.buffer as ArrayBuffer : body;
    const response = await fetch(url.toString(), {
      method,
      headers: signedHeaders,
      body: fetchBody,
    });

    // Handle response
    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (response.status === 204) {
      return {} as T;
    }

    if (contentType.includes('application/json') || contentType.includes('application/x-amz-json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
      data = await response.text();
    } else {
      // Return raw response for binary data
      data = await response.arrayBuffer();
    }

    if (!response.ok) {
      const requestId = response.headers.get('x-amz-request-id') || undefined;
      let errorMessage = `AWS Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'string' && data.includes('<Error>')) {
        // Parse XML error
        const codeMatch = data.match(/<Code>([^<]+)<\/Code>/);
        const messageMatch = data.match(/<Message>([^<]+)<\/Message>/);
        if (codeMatch) errorCode = codeMatch[1];
        if (messageMatch) errorMessage = messageMatch[1];
      } else if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = (errData.__type as string)?.split('#').pop() || errData.code as string;
        errorMessage = (errData.message || errData.Message || errorMessage) as string;
      }

      throw new AWSApiError(errorMessage, response.status, errorCode, requestId);
    }

    return data as T;
  }

  /**
   * Make a request that returns raw bytes
   */
  async requestRaw(
    path: string,
    options: AWSRequestOptions
  ): Promise<{ data: Uint8Array; headers: Headers; status: number }> {
    const { method = 'GET', params, body, headers = {}, service, region = this.region } = options;

    const endpoint = this.getEndpoint(service, region);
    const url = new URL(`https://${endpoint}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const signedHeaders = await this.signRequest(
      method,
      url,
      headers,
      body,
      service,
      region
    );

    const fetchBody = body instanceof Uint8Array ? body.buffer as ArrayBuffer : body;
    const response = await fetch(url.toString(), {
      method,
      headers: signedHeaders,
      body: fetchBody,
    });

    if (!response.ok) {
      const requestId = response.headers.get('x-amz-request-id') || undefined;
      const text = await response.text();
      let errorMessage = `AWS Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (text.includes('<Error>')) {
        const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
        const messageMatch = text.match(/<Message>([^<]+)<\/Message>/);
        if (codeMatch) errorCode = codeMatch[1];
        if (messageMatch) errorMessage = messageMatch[1];
      }

      throw new AWSApiError(errorMessage, response.status, errorCode, requestId);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      data: new Uint8Array(arrayBuffer),
      headers: response.headers,
      status: response.status,
    };
  }

  /**
   * Get current region
   */
  getRegion(): string {
    return this.region;
  }

  /**
   * Get a preview of the access key (for display/debugging)
   */
  getAccessKeyPreview(): string {
    if (this.accessKeyId.length > 8) {
      return `${this.accessKeyId.substring(0, 4)}...${this.accessKeyId.substring(this.accessKeyId.length - 4)}`;
    }
    return '***';
  }
}
