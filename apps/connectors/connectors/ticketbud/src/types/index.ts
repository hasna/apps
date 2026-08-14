export interface TicketbudConfig {
  accessToken: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface TicketbudUser {
  id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  default_subdomain: string;
  image?: string;
  event_ids: number[];
}

export interface EventLocation {
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  name?: string | null;
  location?: string | null;
}

export interface TicketbudEvent {
  id: number;
  title: string;
  event_start: string;
  event_end: string;
  time_zone: string;
  image?: string;
  tickets_available: number;
  sold_out: boolean;
  over: boolean;
  organizer_id: number;
  event_location?: EventLocation;
  uuid?: string;
  event_hashtag?: string;
}

export interface TicketPurchaser {
  status: string;
  full_name: string;
  email?: string;
  price_paid: number | string;
  total_quantity: number;
}

export interface TicketCustomField {
  label: string;
  response: string;
}

export interface TicketbudTicket {
  id: number;
  event_id: number;
  name_on_ticket: string;
  email?: string;
  checked_in: boolean;
  barcode: string;
  barcode_url?: string;
  ticket_type: string;
  purchaser?: TicketPurchaser;
  custom_fields?: TicketCustomField[];
  event?: TicketbudEvent;
  user?: TicketbudUser;
}

export interface EventTotals {
  id: number;
  uuid?: string;
  currency?: string;
  free_tickets_count?: string | number;
  sold_tickets_count?: number;
  sales_total?: number;
  total_payout?: number;
  sales_chart_data?: unknown[];
  sales_by_ticket_type?: Array<{
    name: string;
    quantity: number;
    sold: number;
    available: number;
  }>;
}

export interface TicketbudApiErrorBody {
  error?: string;
  message?: string;
}

export class TicketbudApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: TicketbudApiErrorBody;

  constructor(message: string, statusCode: number, body?: TicketbudApiErrorBody) {
    super(message);
    this.name = 'TicketbudApiError';
    this.statusCode = statusCode;
    this.body = body;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}
