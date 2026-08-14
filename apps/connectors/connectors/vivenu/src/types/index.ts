// Vivenu Distribution API connector types

export interface VivenuConfig {
  apiKey: string;
  distributorType: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// Sellers
export interface DistributionSellerLocation {
  name?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export interface DistributionSeller {
  sellerId: string;
  distributorId: string;
  name: string;
  location?: DistributionSellerLocation;
}

export interface ListSellersParams {
  type?: string;
  skip?: number;
  top?: number;
  sellerId?: string;
}

export interface PaginatedResponse<T> {
  docs: T[];
  total: number;
}

// Events
export interface DistributionEventOffer {
  offerId: string;
  name?: string;
  meta?: Record<string, unknown>;
  price?: number;
  available?: number;
}

export interface DistributionTimeSlot {
  timeSlotId?: string;
  startTime?: { hour?: number; minute?: number };
  offers?: DistributionEventOffer[];
}

export interface DistributionEvent {
  eventId: string;
  name: string;
  start?: string;
  end?: string;
  currency?: string;
  language?: string;
  timezone?: string;
  isRecurring?: boolean;
  usesTimeSlots?: boolean;
  seatingType?: string;
  offers?: DistributionEventOffer[];
  timeSlots?: DistributionTimeSlot[];
  location?: Record<string, unknown>;
  information?: Record<string, unknown>;
}

export interface ListEventsParams {
  distributorId: string;
  start?: string;
  end?: string;
  top?: number;
  skip?: number;
}

export interface GetEventParams {
  distributorId: string;
}

export interface ListAvailabilitiesParams {
  distributorId: string;
  start?: string;
  end?: string;
  top?: number;
  skip?: number;
}

export interface DistributionAvailability {
  eventId: string;
  availibilityId?: string;
  availabilityId?: string;
  name?: string;
  start?: string;
  end?: string;
  timezone?: string;
  salesStart?: string;
  salesEnd?: string;
  currency?: string;
  offers?: DistributionEventOffer[];
  timeSlots?: DistributionTimeSlot[];
}

// Checkout
export interface CheckoutTicketRequest {
  offerId: string;
  eventId: string;
  availabilityId: string;
  price: number;
  seatId?: string;
  timeSlotId?: string;
}

export interface CreateCheckoutRequest {
  distributorId: string;
  tickets: CheckoutTicketRequest[];
  externalReferenceId?: string;
}

export interface CheckoutSeatingInfo {
  type?: string;
  gate?: string;
  name?: string;
  seatId?: string;
  sectionName?: string;
  rowName?: string;
  seatName?: string;
}

export interface CheckoutTicket {
  ticketId?: string;
  offerId?: string;
  barcode?: string;
  url?: string;
  eventId?: string;
  availabilityId?: string;
  timeSlotId?: string;
  seatingInfo?: CheckoutSeatingInfo;
}

export interface CheckoutResponse {
  checkoutId: string;
  transactionId?: string;
  status?: string;
  distributorId?: string;
  expiresAt?: string;
  externalReferenceId?: string;
  tickets?: CheckoutTicket[];
}

export class VivenuApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VivenuApiError';
    this.statusCode = statusCode;
  }
}
