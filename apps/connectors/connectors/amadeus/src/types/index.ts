// Amadeus API Types

export interface AmadeusConfig {
  apiKey: string;
  apiSecret: string;
  environment?: 'test' | 'production';
}

export interface ProfileConfig {
  apiKey?: string;
  apiSecret?: string;
  environment?: 'test' | 'production';
}

export type OutputFormat = 'json' | 'pretty';

// OAuth Token
export interface TokenResponse {
  type: string;
  username: string;
  application_name: string;
  client_id: string;
  token_type: string;
  access_token: string;
  expires_in: number;
  state: string;
  scope: string;
}

// Flight Search Types
export interface FlightSearchParams {
  originLocationCode: string;
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  nonStop?: boolean;
  currencyCode?: string;
  maxPrice?: number;
  max?: number;
}

export interface FlightOffer {
  type: string;
  id: string;
  source: string;
  instantTicketingRequired: boolean;
  nonHomogeneous: boolean;
  oneWay: boolean;
  lastTicketingDate: string;
  numberOfBookableSeats: number;
  itineraries: Itinerary[];
  price: Price;
  pricingOptions: PricingOptions;
  validatingAirlineCodes: string[];
  travelerPricings: TravelerPricing[];
}

export interface Itinerary {
  duration: string;
  segments: Segment[];
}

export interface Segment {
  departure: FlightEndpoint;
  arrival: FlightEndpoint;
  carrierCode: string;
  number: string;
  aircraft: { code: string };
  operating?: { carrierCode: string };
  duration: string;
  id: string;
  numberOfStops: number;
  blacklistedInEU: boolean;
}

export interface FlightEndpoint {
  iataCode: string;
  terminal?: string;
  at: string;
}

export interface Price {
  currency: string;
  total: string;
  base: string;
  fees?: Fee[];
  grandTotal: string;
}

export interface Fee {
  amount: string;
  type: string;
}

export interface PricingOptions {
  fareType: string[];
  includedCheckedBagsOnly: boolean;
}

export interface TravelerPricing {
  travelerId: string;
  fareOption: string;
  travelerType: string;
  price: Price;
  fareDetailsBySegment: FareDetails[];
}

export interface FareDetails {
  segmentId: string;
  cabin: string;
  fareBasis: string;
  brandedFare?: string;
  class: string;
  includedCheckedBags?: { weight?: number; weightUnit?: string; quantity?: number };
}

export interface FlightOffersResponse {
  meta: { count: number; links?: { self: string } };
  data: FlightOffer[];
  dictionaries?: {
    locations?: Record<string, { cityCode: string; countryCode: string }>;
    aircraft?: Record<string, string>;
    currencies?: Record<string, string>;
    carriers?: Record<string, string>;
  };
}

// Airport/City Search
export interface Location {
  type: string;
  subType: string;
  name: string;
  detailedName: string;
  id: string;
  iataCode: string;
  address: {
    cityName: string;
    cityCode: string;
    countryName: string;
    countryCode: string;
    regionCode?: string;
  };
  timeZoneOffset?: string;
}

export interface LocationsResponse {
  meta: { count: number; links?: { self: string } };
  data: Location[];
}

// Flight Price Confirmation
export interface FlightPriceParams {
  flightOffers: FlightOffer[];
}

export interface FlightPriceResponse {
  data: {
    type: string;
    flightOffers: FlightOffer[];
  };
}

// Flight Inspiration/Destinations
export interface FlightDestination {
  type: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  price: { total: string };
}

export interface FlightDestinationsResponse {
  data: FlightDestination[];
  dictionaries?: { currencies?: Record<string, string>; locations?: Record<string, any> };
}

// Airline lookup
export interface Airline {
  type: string;
  iataCode: string;
  icaoCode?: string;
  businessName: string;
  commonName?: string;
}

// Error types
export interface AmadeusError {
  code: number;
  title: string;
  detail?: string;
  source?: { parameter?: string; pointer?: string };
}

export class AmadeusApiError extends Error {
  public readonly code: number;
  public readonly errors: AmadeusError[];

  constructor(message: string, code: number, errors: AmadeusError[] = []) {
    super(message);
    this.name = 'AmadeusApiError';
    this.code = code;
    this.errors = errors;
  }
}
