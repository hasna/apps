export interface ZohoBookingsConfig {
  token: string;
  /** API origin, e.g. https://www.zohoapis.com — path /bookings/v1/json is appended automatically */
  baseUrl?: string;
}

export interface ZohoBookingsCustomerDetails {
  name: string;
  email?: string;
  phone_number?: string;
  [key: string]: unknown;
}

export interface ZohoBookingsWorkspace {
  id: string;
  name: string;
  embed_url?: string;
}

export interface ZohoBookingsService {
  id: string;
  name: string;
  duration?: string;
  service_type?: string;
  price?: number;
  currency?: string;
  assigned_staffs?: string[];
  assigned_workspace?: string;
  embed_url?: string;
}

export interface ZohoBookingsStaff {
  id: string;
  name: string;
  email?: string;
  designation?: string;
  assigned_services?: string[];
  assigned_workspaces?: string[];
  embed_url?: string;
}

export interface ZohoBookingsResource {
  id: string;
  name: string;
}

export interface ZohoBookingsAppointment {
  booking_id: string;
  service_name?: string;
  staff_name?: string;
  start_time?: string;
  end_time?: string;
  duration?: string;
  customer_name?: string;
  customer_email?: string;
  status?: string;
  time_zone?: string;
  [key: string]: unknown;
}

export interface ZohoBookingsCustomer {
  id: string;
  name?: string;
  email?: string;
  contact_number?: string;
  type?: string;
  status?: string;
}

export interface ZohoBookingsEnvelope<T = unknown> {
  response: {
    returnvalue: T;
    status: string;
    errormessage?: string;
  };
}

export class ZohoBookingsApiError extends Error {
  readonly statusCode: number;
  readonly apiStatus?: string;

  constructor(message: string, statusCode: number, apiStatus?: string) {
    super(message);
    this.name = 'ZohoBookingsApiError';
    this.statusCode = statusCode;
    this.apiStatus = apiStatus;
  }
}
