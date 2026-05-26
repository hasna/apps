import * as crypto from 'crypto';
import type { XAdsConfig } from '../types';

const DEFAULT_BASE_URL = 'https://ads-api.twitter.com';
const API_VERSION = '12'; // Twitter Ads API version

export interface XAdsClientConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken?: string;
  accessTokenSecret?: string;
  baseUrl?: string;
}

export class XAdsClient {
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly accessToken?: string;
  private readonly accessTokenSecret?: string;
  private readonly baseUrl: string;

  constructor(config: XAdsClientConfig) {
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.accessToken = config.accessToken;
    this.accessTokenSecret = config.accessTokenSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  // OAuth 1.0a signature generation
  private generateOAuthSignature(
    method: string,
    url: string,
    params: Record<string, string>,
    tokenSecret: string = ''
  ): string {
    // Sort parameters alphabetically
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`)
      .join('&');

    // Create signature base string
    const signatureBaseString = [
      method.toUpperCase(),
      this.percentEncode(url),
      this.percentEncode(sortedParams),
    ].join('&');

    // Create signing key
    const signingKey = `${this.percentEncode(this.consumerSecret)}&${this.percentEncode(tokenSecret)}`;

    // Generate HMAC-SHA1 signature
    const hmac = crypto.createHmac('sha1', signingKey);
    hmac.update(signatureBaseString);
    return hmac.digest('base64');
  }

  private percentEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/!/g, '%21')
      .replace(/\*/g, '%2A')
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }

  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private generateTimestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  // Build OAuth Authorization header
  private buildAuthHeader(
    method: string,
    url: string,
    additionalParams: Record<string, string> = {}
  ): string {
    if (!this.accessToken || !this.accessTokenSecret) {
      throw new Error('Access token and secret required for authenticated requests');
    }

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: this.generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: this.generateTimestamp(),
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };

    // Combine OAuth params with additional params for signature
    const allParams = { ...oauthParams, ...additionalParams };

    // Generate signature
    const signature = this.generateOAuthSignature(
      method,
      url,
      allParams,
      this.accessTokenSecret
    );
    oauthParams.oauth_signature = signature;

    // Build Authorization header
    const authHeader = Object.keys(oauthParams)
      .sort()
      .map((key) => `${this.percentEncode(key)}="${this.percentEncode(oauthParams[key])}"`)
      .join(', ');

    return `OAuth ${authHeader}`;
  }

  // Make authenticated request
  async request<T>(
    method: string,
    endpoint: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
    } = {}
  ): Promise<T> {
    // Build URL with version
    const urlPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const versionedPath = urlPath.startsWith(`/${API_VERSION}`) ? urlPath : `/${API_VERSION}${urlPath}`;
    const baseUrl = `${this.baseUrl}${versionedPath}`;

    // Build query string
    const queryParams: Record<string, string> = {};
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          queryParams[key] = String(value);
        }
      }
    }

    const queryString = Object.keys(queryParams).length > 0
      ? '?' + Object.entries(queryParams)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';

    const fullUrl = `${baseUrl}${queryString}`;

    // For OAuth signature, we need URL without query string for POST with body
    const signatureUrl = baseUrl;

    // Get params for signature (query params for GET, empty for POST with JSON body)
    const signatureParams = method.toUpperCase() === 'GET' ? queryParams : {};

    // Build auth header
    const authHeader = this.buildAuthHeader(method, signatureUrl, signatureParams);

    // Make request
    const headers: Record<string, string> = {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers,
    };

    if (options.body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(fullUrl, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API Error: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.errors) {
          errorMessage = errorJson.errors.map((e: { message: string }) => e.message).join(', ');
        } else if (errorJson.error) {
          errorMessage = errorJson.error;
        }
      } catch {
        if (errorText) {
          errorMessage = errorText;
        }
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data as T;
  }

  // HTTP method shortcuts
  async get<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', endpoint, { params });
  }

  async post<T>(endpoint: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('POST', endpoint, { body, params });
  }

  async put<T>(endpoint: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('PUT', endpoint, { body, params });
  }

  async delete<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('DELETE', endpoint, { params });
  }

  // OAuth helper methods for PIN-based auth flow
  async getRequestToken(): Promise<{ oauthToken: string; oauthTokenSecret: string }> {
    const requestTokenUrl = 'https://api.twitter.com/oauth/request_token';

    const oauthParams: Record<string, string> = {
      oauth_callback: 'oob',
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: this.generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: this.generateTimestamp(),
      oauth_version: '1.0',
    };

    const signature = this.generateOAuthSignature('POST', requestTokenUrl, oauthParams);
    oauthParams.oauth_signature = signature;

    const authHeader = Object.keys(oauthParams)
      .sort()
      .map((key) => `${this.percentEncode(key)}="${this.percentEncode(oauthParams[key])}"`)
      .join(', ');

    const response = await fetch(requestTokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${authHeader}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get request token: ${text}`);
    }

    const text = await response.text();
    const params = new URLSearchParams(text);

    return {
      oauthToken: params.get('oauth_token') || '',
      oauthTokenSecret: params.get('oauth_token_secret') || '',
    };
  }

  getAuthorizeUrl(oauthToken: string): string {
    return `https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}`;
  }

  async getAccessToken(
    oauthToken: string,
    oauthTokenSecret: string,
    pin: string
  ): Promise<{ accessToken: string; accessTokenSecret: string; userId: string; screenName: string }> {
    const accessTokenUrl = 'https://api.twitter.com/oauth/access_token';

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: this.generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: this.generateTimestamp(),
      oauth_token: oauthToken,
      oauth_verifier: pin,
      oauth_version: '1.0',
    };

    const signature = this.generateOAuthSignature('POST', accessTokenUrl, oauthParams, oauthTokenSecret);
    oauthParams.oauth_signature = signature;

    const authHeader = Object.keys(oauthParams)
      .sort()
      .map((key) => `${this.percentEncode(key)}="${this.percentEncode(oauthParams[key])}"`)
      .join(', ');

    const response = await fetch(accessTokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${authHeader}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get access token: ${text}`);
    }

    const text = await response.text();
    const params = new URLSearchParams(text);

    return {
      accessToken: params.get('oauth_token') || '',
      accessTokenSecret: params.get('oauth_token_secret') || '',
      userId: params.get('user_id') || '',
      screenName: params.get('screen_name') || '',
    };
  }

  // Getters
  getBaseUrl(): string {
    return this.baseUrl;
  }

  hasUserTokens(): boolean {
    return !!(this.accessToken && this.accessTokenSecret);
  }
}
