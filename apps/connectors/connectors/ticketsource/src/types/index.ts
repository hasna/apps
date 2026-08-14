export interface TicketSourceConfig {
  apiKey: string;
  baseUrl?: string;
}

export type TicketSourceQuery = Record<string, string | number | boolean | undefined>;

export type TicketSourceJson = Record<string, unknown> | unknown[] | unknown;

export interface TicketSourceEvent extends Record<string, unknown> {
  id?: string | number;
  name?: string;
}

export interface TicketSourceVenue extends Record<string, unknown> {
  id?: string | number;
  name?: string;
}

export interface TicketSourceDate extends Record<string, unknown> {
  id?: string | number;
}

export interface TicketSourceCustomer extends Record<string, unknown> {
  id?: string | number;
  email?: string;
}

export interface TicketSourceBooking extends Record<string, unknown> {
  id?: string | number;
}

export class TicketSourceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'TicketSourceApiError';
  }
}
