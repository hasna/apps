// Ticket Tailor API Types

export interface TicketTailorConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ListQueryParams {
  page?: number;
  limit?: number;
  starting_after?: string;
  ending_before?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface PingResponse {
  version: string;
}

export interface OverviewResponse {
  [key: string]: unknown;
}

export interface Event {
  id: string;
  name?: string;
  status?: string;
  start?: { date?: string; time?: string; timezone?: string };
  end?: { date?: string; time?: string; timezone?: string };
  currency?: string;
  [key: string]: unknown;
}

export interface EventsListResponse {
  data: Event[];
  links?: { next?: string | null; prev?: string | null };
}

export interface Order {
  id: string;
  status?: string;
  buyer_details?: Record<string, unknown>;
  created_at?: number;
  currency?: string;
  total?: number;
  [key: string]: unknown;
}

export interface OrdersListResponse {
  data: Order[];
  links?: { next?: string | null; prev?: string | null };
}

export interface IssuedTicket {
  id: string;
  event_id?: string;
  order_id?: string;
  status?: string;
  barcode?: string;
  [key: string]: unknown;
}

export interface IssuedTicketsListResponse {
  data: IssuedTicket[];
  links?: { next?: string | null; prev?: string | null };
}

export class TicketTailorApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'TicketTailorApiError';
  }
}
