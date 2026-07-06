/**
 * @hasna/connect-takecareos — type definitions
 *
 * Rebuilt against the public TakeCareOS home-care agency API. All shapes are
 * intentionally permissive (optional fields) because the upstream API evolves and
 * agencies enable different modules (scheduling, incidents, billing, compliance).
 */

export interface TakeCareOSConfig {
  /** TakeCareOS API key (Bearer token). */
  apiKey: string;
  /** Optional base URL override (defaults to https://api.takecareos.com/v1). */
  baseUrl?: string;
}

/** A care recipient / client of the home-care agency. */
export interface TakeCareOSClient {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  status?: string;
  care_plan_id?: string;
  created_at?: string;
  updated_at?: string;
}

/** A caregiver / field worker employed by the agency. */
export interface TakeCareOSCaregiver {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  role?: string;
  certifications?: string[];
  status?: string;
  hired_at?: string;
}

/** A scheduled visit / shift assigning a caregiver to a client. */
export interface TakeCareOSShift {
  id: string;
  client_id: string;
  caregiver_id?: string;
  start_time: string;
  end_time: string;
  status?: string;
  service_type?: string;
  notes?: string;
  created_at?: string;
}

/** Payload for scheduling a new shift. */
export interface CreateShiftInput {
  client_id: string;
  caregiver_id?: string;
  start_time: string;
  end_time: string;
  service_type?: string;
  notes?: string;
}

/** An incident report filed against a shift or client. */
export interface TakeCareOSIncident {
  id: string;
  client_id?: string;
  caregiver_id?: string;
  shift_id?: string;
  type?: string;
  severity?: string;
  description?: string;
  status?: string;
  reported_at?: string;
}

/** Payload for filing a new incident report. */
export interface CreateIncidentInput {
  client_id?: string;
  caregiver_id?: string;
  shift_id?: string;
  type: string;
  severity?: string;
  description: string;
}

/** An invoice raised for services rendered to a client. */
export interface TakeCareOSInvoice {
  id: string;
  client_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  issued_at?: string;
  due_at?: string;
  paid_at?: string;
}

/** A compliance report snapshot across the agency. */
export interface TakeCareOSComplianceReport {
  generated_at?: string;
  period_start?: string;
  period_end?: string;
  total_caregivers?: number;
  compliant_caregivers?: number;
  expiring_certifications?: number;
  open_incidents?: number;
  items?: Array<{
    caregiver_id?: string;
    requirement?: string;
    status?: string;
    expires_at?: string;
  }>;
}

/** Generic paginated list envelope returned by list endpoints. */
export interface TakeCareOSList<T> {
  data: T[];
  total?: number;
  page?: number;
  per_page?: number;
}

/** Error thrown for non-2xx API responses. */
export class TakeCareOSApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "TakeCareOSApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
