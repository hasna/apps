import type { AmadeusClient } from './client';
import type {
  FlightSearchParams,
  FlightOffersResponse,
  FlightPriceResponse,
  FlightOffer,
  LocationsResponse,
  FlightDestinationsResponse,
  Airline,
} from '../types';

export class FlightsApi {
  constructor(private readonly client: AmadeusClient) {}

  /**
   * Search for flight offers
   */
  async searchOffers(params: FlightSearchParams): Promise<FlightOffersResponse> {
    const queryParams: Record<string, any> = {
      originLocationCode: params.originLocationCode,
      destinationLocationCode: params.destinationLocationCode,
      departureDate: params.departureDate,
      adults: params.adults,
    };

    if (params.returnDate) queryParams.returnDate = params.returnDate;
    if (params.children) queryParams.children = params.children;
    if (params.infants) queryParams.infants = params.infants;
    if (params.travelClass) queryParams.travelClass = params.travelClass;
    if (params.nonStop !== undefined) queryParams.nonStop = params.nonStop;
    if (params.currencyCode) queryParams.currencyCode = params.currencyCode;
    if (params.maxPrice) queryParams.maxPrice = params.maxPrice;
    if (params.max) queryParams.max = params.max;

    return this.client.get<FlightOffersResponse>('/v2/shopping/flight-offers', queryParams);
  }

  /**
   * Confirm pricing for selected flight offers
   */
  async priceOffers(flightOffers: FlightOffer[]): Promise<FlightPriceResponse> {
    return this.client.post<FlightPriceResponse>('/v1/shopping/flight-offers/pricing', {
      data: {
        type: 'flight-offers-pricing',
        flightOffers,
      },
    });
  }

  /**
   * Search for airports and cities by keyword
   */
  async searchLocations(keyword: string, subType?: 'AIRPORT' | 'CITY'): Promise<LocationsResponse> {
    const params: Record<string, any> = {
      keyword,
      subType: subType || 'AIRPORT,CITY',
    };
    return this.client.get<LocationsResponse>('/v1/reference-data/locations', params);
  }

  /**
   * Get airport/city by IATA code
   */
  async getLocation(iataCode: string): Promise<LocationsResponse> {
    return this.client.get<LocationsResponse>('/v1/reference-data/locations/' + iataCode);
  }

  /**
   * Find cheapest flight destinations from origin
   */
  async inspirationSearch(origin: string, options?: {
    departureDate?: string;
    oneWay?: boolean;
    duration?: string;
    nonStop?: boolean;
    maxPrice?: number;
    viewBy?: 'DATE' | 'DESTINATION' | 'DURATION' | 'WEEK';
  }): Promise<FlightDestinationsResponse> {
    const params: Record<string, any> = { origin };
    if (options?.departureDate) params.departureDate = options.departureDate;
    if (options?.oneWay !== undefined) params.oneWay = options.oneWay;
    if (options?.duration) params.duration = options.duration;
    if (options?.nonStop !== undefined) params.nonStop = options.nonStop;
    if (options?.maxPrice) params.maxPrice = options.maxPrice;
    if (options?.viewBy) params.viewBy = options.viewBy;

    return this.client.get<FlightDestinationsResponse>('/v1/shopping/flight-destinations', params);
  }

  /**
   * Get cheapest dates for a route
   */
  async cheapestDates(origin: string, destination: string, options?: {
    departureDate?: string;
    oneWay?: boolean;
    duration?: string;
    nonStop?: boolean;
    maxPrice?: number;
    viewBy?: 'DATE' | 'DURATION' | 'WEEK';
  }): Promise<FlightDestinationsResponse> {
    const params: Record<string, any> = { origin, destination };
    if (options?.departureDate) params.departureDate = options.departureDate;
    if (options?.oneWay !== undefined) params.oneWay = options.oneWay;
    if (options?.duration) params.duration = options.duration;
    if (options?.nonStop !== undefined) params.nonStop = options.nonStop;
    if (options?.maxPrice) params.maxPrice = options.maxPrice;
    if (options?.viewBy) params.viewBy = options.viewBy;

    return this.client.get<FlightDestinationsResponse>('/v1/shopping/flight-dates', params);
  }

  /**
   * Get airline information by IATA code
   */
  async getAirline(airlineCode: string): Promise<{ data: Airline[] }> {
    return this.client.get<{ data: Airline[] }>('/v1/reference-data/airlines', {
      airlineCodes: airlineCode,
    });
  }

  /**
   * Search airlines by name
   */
  async searchAirlines(keyword: string): Promise<{ data: Airline[] }> {
    return this.client.get<{ data: Airline[] }>('/v1/reference-data/airlines', {
      keyword,
    });
  }
}
