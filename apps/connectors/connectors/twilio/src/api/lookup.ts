import type { TwilioClient } from './client';
import type { LookupResult, LookupParams } from '../types';

const LOOKUP_BASE_URL = 'https://lookups.twilio.com/v2';

/**
 * Twilio Lookup API
 * Get information about phone numbers
 */
export class LookupApi {
  private readonly baseUrl = LOOKUP_BASE_URL;

  constructor(private readonly client: TwilioClient) {}

  /**
   * Make a request to the Lookup API (different base URL)
   */
  private async lookupRequest<T>(method: string, path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const credentials = Buffer.from(`${this.client.getAccountSid()}:${(this.client as unknown as { authToken: string }).authToken}`).toString('base64');

    const headers: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    };

    const response = await fetch(url, { method, headers });

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || response.statusText);
    }

    return data as T;
  }

  /**
   * Look up a phone number with specified fields
   *
   * Available fields:
   * - caller_name: Caller ID name
   * - carrier: Carrier information (removed - see line_type_intelligence)
   * - line_type_intelligence: Line type and carrier info
   * - live_activity: Real-time line activity
   * - sim_swap: SIM swap detection
   * - call_forwarding: Call forwarding status
   * - identity_match: Identity verification
   * - reassigned_number: Number reassignment detection
   * - sms_pumping_risk: SMS fraud risk score
   * - phone_number_quality_score: Number quality score
   * - pre_fill: Pre-populated identity data
   */
  async lookup(phoneNumber: string, params?: LookupParams): Promise<LookupResult> {
    // Ensure phone number is URL-encoded
    const encodedNumber = encodeURIComponent(phoneNumber);
    return this.lookupRequest<LookupResult>(
      'GET',
      `/PhoneNumbers/${encodedNumber}`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Get basic phone number validation
   */
  async validate(phoneNumber: string, countryCode?: string): Promise<{
    valid: boolean;
    calling_country_code: string;
    country_code: string;
    phone_number: string;
    national_format: string;
  }> {
    const result = await this.lookup(phoneNumber, { CountryCode: countryCode });
    return {
      valid: result.valid,
      calling_country_code: result.calling_country_code,
      country_code: result.country_code,
      phone_number: result.phone_number,
      national_format: result.national_format,
    };
  }

  /**
   * Get line type information (carrier and type)
   */
  async getLineType(phoneNumber: string): Promise<{
    phone_number: string;
    valid: boolean;
    line_type: string | null;
    carrier_name: string | null;
    mobile_country_code: string | null;
    mobile_network_code: string | null;
  }> {
    const result = await this.lookup(phoneNumber, { Fields: 'line_type_intelligence' });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      line_type: result.line_type_intelligence?.type || null,
      carrier_name: result.line_type_intelligence?.carrier_name || null,
      mobile_country_code: result.line_type_intelligence?.mobile_country_code || null,
      mobile_network_code: result.line_type_intelligence?.mobile_network_code || null,
    };
  }

  /**
   * Get caller name (CNAM) information
   */
  async getCallerName(phoneNumber: string): Promise<{
    phone_number: string;
    valid: boolean;
    caller_name: string | null;
    caller_type: 'CONSUMER' | 'BUSINESS' | null;
  }> {
    const result = await this.lookup(phoneNumber, { Fields: 'caller_name' });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      caller_name: result.caller_name?.caller_name || null,
      caller_type: result.caller_name?.caller_type || null,
    };
  }

  /**
   * Get SIM swap information
   */
  async getSimSwap(phoneNumber: string): Promise<{
    phone_number: string;
    valid: boolean;
    last_sim_swap_date: string | null;
    swapped_period: string | null;
    swapped_in_period: boolean | null;
  }> {
    const result = await this.lookup(phoneNumber, { Fields: 'sim_swap' });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      last_sim_swap_date: result.sim_swap?.last_sim_swap?.last_sim_swap_date || null,
      swapped_period: result.sim_swap?.last_sim_swap?.swapped_period || null,
      swapped_in_period: result.sim_swap?.last_sim_swap?.swapped_in_period || null,
    };
  }

  /**
   * Get call forwarding status
   */
  async getCallForwarding(phoneNumber: string): Promise<{
    phone_number: string;
    valid: boolean;
    call_forwarding_status: boolean | null;
  }> {
    const result = await this.lookup(phoneNumber, { Fields: 'call_forwarding' });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      call_forwarding_status: result.call_forwarding?.call_forwarding_status || null,
    };
  }

  /**
   * Get live activity (connectivity and roaming)
   */
  async getLiveActivity(phoneNumber: string): Promise<{
    phone_number: string;
    valid: boolean;
    connectivity: string | null;
    ported: boolean | null;
    roaming_status: string | null;
    roaming_country: string | null;
  }> {
    const result = await this.lookup(phoneNumber, { Fields: 'live_activity' });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      connectivity: result.live_activity?.connectivity || null,
      ported: result.live_activity?.ported || null,
      roaming_status: result.live_activity?.roaming?.status || null,
      roaming_country: result.live_activity?.roaming?.roaming_country_code || null,
    };
  }

  /**
   * Check if number has been reassigned
   */
  async getReassignedNumber(phoneNumber: string, lastVerifiedDate?: string): Promise<{
    phone_number: string;
    valid: boolean;
    last_verified_date: string | null;
    is_reassigned: boolean | null;
  }> {
    const result = await this.lookup(phoneNumber, {
      Fields: 'reassigned_number',
      LastVerifiedDate: lastVerifiedDate,
    });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      last_verified_date: result.reassigned_number?.last_verified_date || null,
      is_reassigned: result.reassigned_number?.is_reassigned || null,
    };
  }

  /**
   * Get SMS pumping risk score
   */
  async getSmsPumpingRisk(phoneNumber: string): Promise<{
    phone_number: string;
    valid: boolean;
    sms_pumping_risk_score: number | null;
    carrier_risk_score: number | null;
    carrier_risk_category: string | null;
    number_blocked: boolean | null;
  }> {
    const result = await this.lookup(phoneNumber, { Fields: 'sms_pumping_risk' });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      sms_pumping_risk_score: result.sms_pumping_risk?.sms_pumping_risk_score || null,
      carrier_risk_score: result.sms_pumping_risk?.carrier_risk_score || null,
      carrier_risk_category: result.sms_pumping_risk?.carrier_risk_category || null,
      number_blocked: result.sms_pumping_risk?.number_blocked || null,
    };
  }

  /**
   * Get phone number quality score
   */
  async getQualityScore(phoneNumber: string): Promise<{
    phone_number: string;
    valid: boolean;
    quality_score: number | null;
  }> {
    const result = await this.lookup(phoneNumber, { Fields: 'phone_number_quality_score' });
    return {
      phone_number: result.phone_number,
      valid: result.valid,
      quality_score: result.phone_number_quality_score?.quality_score || null,
    };
  }

  /**
   * Get comprehensive lookup with multiple fields
   */
  async getComprehensive(phoneNumber: string): Promise<LookupResult> {
    return this.lookup(phoneNumber, {
      Fields: 'line_type_intelligence,caller_name,sim_swap,call_forwarding,sms_pumping_risk,phone_number_quality_score',
    });
  }
}
