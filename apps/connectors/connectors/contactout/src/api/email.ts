import type { ContactOutClient } from './client';
import type {
  EmailEnrichParams,
  EmailEnrichResponse,
  EmailVerifyResponse,
  BatchEmailVerifyParams,
  BatchEmailVerifyResponse,
  BatchEmailVerifyJobResponse,
  EmailToLinkedInResponse,
} from '../types';

/**
 * Email API - Enrich profiles from email, verify emails, find LinkedIn from email
 */
export class EmailApi {
  constructor(private readonly client: ContactOutClient) {}

  /**
   * Enrich a profile from an email address
   * @param params.email - Email address to lookup
   * @param params.include - Optional: include work_email in response
   * @returns Full profile data mapped to email
   * @cost 1 email/phone credit per match
   */
  async enrich(params: EmailEnrichParams): Promise<EmailEnrichResponse> {
    return this.client.get<EmailEnrichResponse>('/v1/email/enrich', {
      email: params.email,
      include: params.include,
    });
  }

  /**
   * Verify a single email address
   * @param email - Email address to verify
   * @returns Verification status: valid, invalid, accept_all, disposable, or unknown
   * @cost 1 verifier credit if result is valid/invalid/accept_all
   */
  async verify(email: string): Promise<EmailVerifyResponse> {
    return this.client.get<EmailVerifyResponse>('/v1/email/verify', {
      email,
    });
  }

  /**
   * Batch verify multiple email addresses (asynchronous)
   * @param params.emails - Array of email addresses (max 1000)
   * @param params.callback_url - Optional webhook URL for completion notification
   * @returns Job ID for polling
   * @cost 1 verifier credit per email (valid/invalid/accept_all results)
   */
  async batchVerify(params: BatchEmailVerifyParams): Promise<BatchEmailVerifyResponse> {
    if (params.emails.length > 1000) {
      throw new Error('Maximum 1000 emails allowed per batch');
    }
    return this.client.post<BatchEmailVerifyResponse>('/v1/email/verify/batch', {
      emails: params.emails,
      callback_url: params.callback_url,
    });
  }

  /**
   * Get batch verification job status and results
   * @param jobId - Job UUID from batchVerify
   * @returns Job status and results when complete
   */
  async getBatchVerifyJob(jobId: string): Promise<BatchEmailVerifyJobResponse> {
    return this.client.get<BatchEmailVerifyJobResponse>(`/v1/email/verify/batch/${jobId}`);
  }

  /**
   * Find LinkedIn profile URL from an email address
   * @param email - Email address to lookup
   * @returns LinkedIn profile URL if found
   * @cost 1 email credit if found
   */
  async toLinkedIn(email: string): Promise<EmailToLinkedInResponse> {
    return this.client.get<EmailToLinkedInResponse>('/v1/people/person', {
      email,
    });
  }
}
