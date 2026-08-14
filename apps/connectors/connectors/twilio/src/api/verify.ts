import type { TwilioClient } from './client';
import type {
  VerifyService,
  VerifyServiceListResponse,
  Verification,
  VerificationCheck,
  CreateVerificationParams,
  CheckVerificationParams,
} from '../types';

const VERIFY_BASE_URL = 'https://verify.twilio.com/v2';

/**
 * Twilio Verify API
 * 2FA verification: create and check verification codes
 */
export class VerifyApi {
  private readonly baseUrl = VERIFY_BASE_URL;

  constructor(private readonly client: TwilioClient) {}

  /**
   * Make a request to the Verify API (different base URL)
   */
  private async verifyRequest<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const credentials = Buffer.from(`${this.client.getAccountSid()}:${(this.client as unknown as { authToken: string }).authToken}`).toString('base64');

    const headers: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
          } else {
            params.append(key, String(value));
          }
        }
      });
      fetchOptions.body = params.toString();
      fetchOptions.headers = headers;
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || response.statusText);
    }

    return data as T;
  }

  // ============================================
  // Verify Services
  // ============================================

  /**
   * Create a new Verify Service
   */
  async createService(params: {
    FriendlyName: string;
    CodeLength?: number;
    LookupEnabled?: boolean;
    SkipSmsToLandlines?: boolean;
    DtmfInputRequired?: boolean;
    TtsName?: string;
    Psd2Enabled?: boolean;
    DoNotShareWarningEnabled?: boolean;
  }): Promise<VerifyService> {
    return this.verifyRequest<VerifyService>('POST', '/Services', params);
  }

  /**
   * List all Verify Services
   */
  async listServices(params?: { PageSize?: number; Page?: number }): Promise<VerifyServiceListResponse> {
    const query = params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : '';
    return this.verifyRequest<VerifyServiceListResponse>('GET', `/Services${query}`);
  }

  /**
   * Get a Verify Service by SID
   */
  async getService(serviceSid: string): Promise<VerifyService> {
    return this.verifyRequest<VerifyService>('GET', `/Services/${serviceSid}`);
  }

  /**
   * Update a Verify Service
   */
  async updateService(serviceSid: string, params: {
    FriendlyName?: string;
    CodeLength?: number;
    LookupEnabled?: boolean;
    SkipSmsToLandlines?: boolean;
    DtmfInputRequired?: boolean;
    TtsName?: string;
    Psd2Enabled?: boolean;
    DoNotShareWarningEnabled?: boolean;
  }): Promise<VerifyService> {
    return this.verifyRequest<VerifyService>('POST', `/Services/${serviceSid}`, params);
  }

  /**
   * Delete a Verify Service
   */
  async deleteService(serviceSid: string): Promise<void> {
    await this.verifyRequest<void>('DELETE', `/Services/${serviceSid}`);
  }

  // ============================================
  // Verifications
  // ============================================

  /**
   * Create a new verification (send code)
   */
  async create(serviceSid: string, params: CreateVerificationParams): Promise<Verification> {
    return this.verifyRequest<Verification>(
      'POST',
      `/Services/${serviceSid}/Verifications`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Check a verification code
   */
  async check(serviceSid: string, params: CheckVerificationParams): Promise<VerificationCheck> {
    return this.verifyRequest<VerificationCheck>(
      'POST',
      `/Services/${serviceSid}/VerificationCheck`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Get a verification by SID
   */
  async get(serviceSid: string, verificationSid: string): Promise<Verification> {
    return this.verifyRequest<Verification>(
      'GET',
      `/Services/${serviceSid}/Verifications/${verificationSid}`
    );
  }

  /**
   * Update (cancel) a verification
   */
  async cancel(serviceSid: string, verificationSid: string): Promise<Verification> {
    return this.verifyRequest<Verification>(
      'POST',
      `/Services/${serviceSid}/Verifications/${verificationSid}`,
      { Status: 'canceled' }
    );
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Send an SMS verification code
   */
  async sendSms(serviceSid: string, to: string, options?: Omit<CreateVerificationParams, 'To' | 'Channel'>): Promise<Verification> {
    return this.create(serviceSid, { ...options, To: to, Channel: 'sms' });
  }

  /**
   * Send a voice call verification code
   */
  async sendCall(serviceSid: string, to: string, options?: Omit<CreateVerificationParams, 'To' | 'Channel'>): Promise<Verification> {
    return this.create(serviceSid, { ...options, To: to, Channel: 'call' });
  }

  /**
   * Send an email verification code
   */
  async sendEmail(serviceSid: string, to: string, options?: Omit<CreateVerificationParams, 'To' | 'Channel'>): Promise<Verification> {
    return this.create(serviceSid, { ...options, To: to, Channel: 'email' });
  }

  /**
   * Send a WhatsApp verification code
   */
  async sendWhatsApp(serviceSid: string, to: string, options?: Omit<CreateVerificationParams, 'To' | 'Channel'>): Promise<Verification> {
    return this.create(serviceSid, { ...options, To: to, Channel: 'whatsapp' });
  }

  /**
   * Verify a code
   */
  async verifyCode(serviceSid: string, to: string, code: string): Promise<VerificationCheck> {
    return this.check(serviceSid, { To: to, Code: code });
  }
}
