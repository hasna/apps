export type OutputFormat = 'json' | 'pretty';

export interface TomTomConfig {
  apiKey: string;
}

export interface TomTomPosition {
  lat: number;
  lon: number;
}

export interface TomTomAddress {
  freeformAddress?: string;
  municipality?: string;
  country?: string;
  countryCode?: string;
  streetName?: string;
  streetNumber?: string;
  postalCode?: string;
}

export interface TomTomSearchResult {
  id?: string;
  type?: string;
  score?: number;
  dist?: number;
  position?: TomTomPosition;
  address?: TomTomAddress;
  poi?: {
    name?: string;
    categories?: string[];
  };
}

export interface TomTomSearchResponse {
  summary?: {
    query?: string;
    queryType?: string;
    numResults?: number;
  };
  results?: TomTomSearchResult[];
}

export interface TomTomRouteSummary {
  lengthInMeters?: number;
  travelTimeInSeconds?: number;
  trafficDelayInSeconds?: number;
  departureTime?: string;
  arrivalTime?: string;
}

export interface TomTomRouteLeg {
  summary?: TomTomRouteSummary;
  points?: Array<{ latitude: number; longitude: number }>;
}

export interface TomTomRoute {
  summary?: TomTomRouteSummary;
  legs?: TomTomRouteLeg[];
}

export interface TomTomRouteResponse {
  formatVersion?: string;
  routes?: TomTomRoute[];
}

export type TravelMode = 'car' | 'truck' | 'taxi' | 'bus' | 'van' | 'motorcycle' | 'bicycle' | 'pedestrian';

export class TomTomError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'TomTomError';
  }
}
