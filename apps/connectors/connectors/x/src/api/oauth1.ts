/**
 * OAuth 1.0a Authentication
 * Required for legacy endpoints like media upload (v1.1 API)
 */

import { createHmac, randomBytes } from 'crypto';

// OAuth 1.0a endpoints
const REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const AUTHORIZE_URL = 'https://api.twitter.com/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';

export interface OAuth1Config {
  consumerKey: string;
  consumerSecret: string;
  accessToken?: string;
  accessTokenSecret?: string;
}

export interface OAuth1Tokens {
  oauthToken: string;
  oauthTokenSecret: string;
  userId?: string;
  screenName?: string;
}

export interface OAuth1RequestToken {
  oauthToken: string;
  oauthTokenSecret: string;
  oauthCallbackConfirmed: boolean;
}

/**
 * Generate OAuth 1.0a nonce
 */
function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate OAuth 1.0a timestamp
 */
function generateTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/**
 * Percent encode a string per RFC 3986
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Create OAuth 1.0a signature base string
 */
function createSignatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>
): string {
  // Sort parameters alphabetically
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');

  // Remove query string from URL for base string
  const baseUrl = url.split('?')[0];

  return `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(sortedParams)}`;
}

/**
 * Create HMAC-SHA1 signature
 */
function createSignature(
  baseString: string,
  consumerSecret: string,
  tokenSecret: string = ''
): string {
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', signingKey).update(baseString).digest('base64');
}

/**
 * Build OAuth 1.0a Authorization header
 */
export function buildOAuth1Header(
  config: OAuth1Config,
  method: string,
  url: string,
  additionalParams: Record<string, string> = {}
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: generateTimestamp(),
    oauth_version: '1.0',
  };

  if (config.accessToken) {
    oauthParams['oauth_token'] = config.accessToken;
  }

  // Combine OAuth params with additional params for signature
  const allParams = { ...oauthParams, ...additionalParams };

  // Create signature
  const baseString = createSignatureBaseString(method, url, allParams);
  const signature = createSignature(
    baseString,
    config.consumerSecret,
    config.accessTokenSecret
  );

  oauthParams['oauth_signature'] = signature;

  // Build Authorization header
  const headerParams = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ');

  return `OAuth ${headerParams}`;
}

/**
 * Get request token (Step 1 of 3-legged OAuth)
 */
export async function getRequestToken(
  config: OAuth1Config,
  callbackUrl: string
): Promise<OAuth1RequestToken> {
  const oauthParams: Record<string, string> = {
    oauth_callback: callbackUrl,
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: generateTimestamp(),
    oauth_version: '1.0',
  };

  const baseString = createSignatureBaseString('POST', REQUEST_TOKEN_URL, oauthParams);
  const signature = createSignature(baseString, config.consumerSecret);
  oauthParams['oauth_signature'] = signature;

  const headerParams = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ');

  const response = await fetch(REQUEST_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${headerParams}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get request token: ${errorText}`);
  }

  const text = await response.text();
  const params = new URLSearchParams(text);

  return {
    oauthToken: params.get('oauth_token') || '',
    oauthTokenSecret: params.get('oauth_token_secret') || '',
    oauthCallbackConfirmed: params.get('oauth_callback_confirmed') === 'true',
  };
}

/**
 * Build authorization URL (Step 2 of 3-legged OAuth)
 */
export function buildOAuth1AuthorizationUrl(oauthToken: string): string {
  return `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(oauthToken)}`;
}

/**
 * Exchange request token for access token (Step 3 of 3-legged OAuth)
 */
export async function getAccessToken(
  config: OAuth1Config,
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string
): Promise<OAuth1Tokens> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: generateTimestamp(),
    oauth_token: oauthToken,
    oauth_verifier: oauthVerifier,
    oauth_version: '1.0',
  };

  const baseString = createSignatureBaseString('POST', ACCESS_TOKEN_URL, oauthParams);
  const signature = createSignature(baseString, config.consumerSecret, oauthTokenSecret);
  oauthParams['oauth_signature'] = signature;

  const headerParams = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ');

  const response = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${headerParams}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get access token: ${errorText}`);
  }

  const text = await response.text();
  const params = new URLSearchParams(text);

  return {
    oauthToken: params.get('oauth_token') || '',
    oauthTokenSecret: params.get('oauth_token_secret') || '',
    userId: params.get('user_id') || undefined,
    screenName: params.get('screen_name') || undefined,
  };
}

/**
 * Make an OAuth 1.0a authenticated request
 */
export async function oauth1Request<T>(
  config: OAuth1Config,
  method: string,
  url: string,
  body?: Record<string, string> | FormData | string,
  additionalHeaders?: Record<string, string>
): Promise<T> {
  // For form-encoded body, include params in signature
  let bodyParams: Record<string, string> = {};
  let requestBody: string | FormData | undefined;
  const headers: Record<string, string> = { ...additionalHeaders };

  if (body) {
    if (body instanceof FormData) {
      // FormData (for multipart/form-data like media upload)
      requestBody = body;
      // Don't set Content-Type - let fetch set it with boundary
    } else if (typeof body === 'string') {
      // Raw string body
      requestBody = body;
    } else {
      // Object body - form-encode it
      bodyParams = body;
      requestBody = new URLSearchParams(body).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  const authHeader = buildOAuth1Header(config, method, url, bodyParams);
  headers['Authorization'] = authHeader;

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OAuth 1.0a request failed: ${response.status} - ${errorText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}

/**
 * OAuth 1.0a client for making authenticated requests
 */
export class OAuth1Client {
  private config: OAuth1Config;

  constructor(config: OAuth1Config) {
    if (!config.consumerKey || !config.consumerSecret) {
      throw new Error('Consumer key and secret are required');
    }
    this.config = config;
  }

  /**
   * Check if we have user tokens
   */
  hasUserTokens(): boolean {
    return !!(this.config.accessToken && this.config.accessTokenSecret);
  }

  /**
   * Set user tokens
   */
  setTokens(oauthToken: string, oauthTokenSecret: string): void {
    this.config.accessToken = oauthToken;
    this.config.accessTokenSecret = oauthTokenSecret;
  }

  /**
   * Make authenticated GET request
   */
  async get<T>(url: string, params?: Record<string, string>): Promise<T> {
    const urlWithParams = params
      ? `${url}?${new URLSearchParams(params).toString()}`
      : url;
    return oauth1Request<T>(this.config, 'GET', urlWithParams);
  }

  /**
   * Make authenticated POST request
   */
  async post<T>(
    url: string,
    body?: Record<string, string> | FormData | string,
    headers?: Record<string, string>
  ): Promise<T> {
    return oauth1Request<T>(this.config, 'POST', url, body, headers);
  }

  /**
   * Build authorization header for a request
   */
  buildAuthHeader(
    method: string,
    url: string,
    params?: Record<string, string>
  ): string {
    return buildOAuth1Header(this.config, method, url, params);
  }
}
