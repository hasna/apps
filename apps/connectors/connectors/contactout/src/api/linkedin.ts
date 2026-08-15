import type { ContactOutClient } from './client';
import type {
  LinkedInEnrichParams,
  LinkedInEnrichResponse,
  ContactInfoParams,
  ContactInfoResponse,
  BatchContactParams,
  BatchContactResponse,
  BatchJobResponse,
  EmailStatusResponse,
  PhoneStatusResponse,
} from '../types';

/**
 * LinkedIn Profile API - Enrich and get contact info from LinkedIn profiles
 */
export class LinkedInApi {
  constructor(private readonly client: ContactOutClient) {}

  /**
   * Enrich a LinkedIn profile - get full profile data including contact info
   * @param params.profile - LinkedIn profile URL
   * @param params.profile_only - If true, returns profile without contact info
   * @returns Profile data with emails and phones
   * @cost 1 email/phone credit per match; 1 search credit if profile_only
   */
  async enrich(params: LinkedInEnrichParams): Promise<LinkedInEnrichResponse> {
    return this.client.get<LinkedInEnrichResponse>('/v1/linkedin/enrich', {
      profile: params.profile,
      profile_only: params.profile_only,
    });
  }

  /**
   * Get contact info for a single LinkedIn profile
   * @param params.profile - LinkedIn profile URL
   * @param params.include_phone - Include phone numbers in response
   * @param params.email_type - Type of email to return: personal, work, personal,work, or none
   * @returns Email addresses and phone numbers
   * @cost 1 email/phone credit per match
   */
  async getContactInfo(params: ContactInfoParams): Promise<ContactInfoResponse> {
    return this.client.get<ContactInfoResponse>('/v1/people/linkedin', {
      profile: params.profile,
      include_phone: params.include_phone,
      email_type: params.email_type,
    });
  }

  /**
   * Batch get contact info for up to 30 LinkedIn profiles (synchronous)
   * @param params.profiles - Array of LinkedIn profile URLs (max 30)
   * @returns Map of LinkedIn URLs to email arrays
   * @cost 1 email credit per profile with match
   */
  async batchContactInfo(params: BatchContactParams): Promise<BatchContactResponse> {
    if (params.profiles.length > 30) {
      throw new Error('V1 batch endpoint supports maximum 30 profiles. Use batchContactInfoAsync for larger batches.');
    }
    return this.client.post<BatchContactResponse>('/v1/people/linkedin/batch', {
      profiles: params.profiles,
    });
  }

  /**
   * Batch get contact info for up to 1000 LinkedIn profiles (asynchronous)
   * @param params.profiles - Array of LinkedIn profile URLs (max 1000)
   * @param params.callback_url - Optional webhook URL for completion notification
   * @param params.include_phone - Include phone numbers in response
   * @returns Job ID for polling
   * @cost 1 email credit per profile with match
   */
  async batchContactInfoAsync(params: BatchContactParams): Promise<BatchContactResponse> {
    if (params.profiles.length > 1000) {
      throw new Error('V2 batch endpoint supports maximum 1000 profiles');
    }
    return this.client.post<BatchContactResponse>('/v2/people/linkedin/batch', {
      profiles: params.profiles,
      callback_url: params.callback_url,
      include_phone: params.include_phone,
    });
  }

  /**
   * Get batch job status and results
   * @param jobId - Job UUID from batchContactInfoAsync
   * @returns Job status and results when complete
   */
  async getBatchJob(jobId: string): Promise<BatchJobResponse> {
    return this.client.get<BatchJobResponse>(`/v2/people/linkedin/batch/${jobId}`);
  }

  /**
   * Check if personal email is available for a LinkedIn profile
   * @param profile - LinkedIn profile URL
   * @returns Boolean indicating if personal email is available
   * @cost No credits consumed
   * @access Paid users only
   */
  async checkPersonalEmailStatus(profile: string): Promise<EmailStatusResponse> {
    return this.client.get<EmailStatusResponse>('/v1/people/linkedin/personal_email_status', {
      profile,
    });
  }

  /**
   * Check if work email is available for a LinkedIn profile
   * @param profile - LinkedIn profile URL
   * @returns Email availability and verification status
   * @cost No credits consumed
   * @access Paid users only
   */
  async checkWorkEmailStatus(profile: string): Promise<EmailStatusResponse> {
    return this.client.get<EmailStatusResponse>('/v1/people/linkedin/work_email_status', {
      profile,
    });
  }

  /**
   * Check if phone number is available for a LinkedIn profile
   * @param profile - LinkedIn profile URL
   * @returns Boolean indicating if phone is available
   * @cost No credits consumed
   * @access Paid users only
   */
  async checkPhoneStatus(profile: string): Promise<PhoneStatusResponse> {
    return this.client.get<PhoneStatusResponse>('/v1/people/linkedin/phone_status', {
      profile,
    });
  }
}
