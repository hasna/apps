import type {
  GoogleMapsConfig,
  GeocodingResponse,
  PlacesSearchResponse,
  PlaceDetailsResponse,
  DirectionsRequest,
  DirectionsResponse,
  DistanceMatrixRequest,
  DistanceMatrixResponse,
  NearbySearchRequest,
  TextSearchRequest,
  TravelMode,
  AvoidType,
} from '../types';
import { GoogleMapsError } from '../types';

const BASE_URL = 'https://maps.googleapis.com/maps/api';

export class GoogleMaps {
  private apiKey: string;

  constructor(config: GoogleMapsConfig) {
    this.apiKey = config.apiKey;
  }

  private async request<T>(endpoint: string, params: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set('key', this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString());
    const data = await response.json() as T & { status: string; error_message?: string };

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new GoogleMapsError(
        data.error_message || `API returned status: ${data.status}`,
        data.status,
        data.error_message
      );
    }

    return data;
  }

  // ============================================
  // Geocoding API
  // ============================================

  /**
   * Convert address to coordinates (geocoding)
   */
  async geocode(address: string): Promise<GeocodingResponse> {
    return this.request<GeocodingResponse>('/geocode/json', { address });
  }

  /**
   * Convert coordinates to address (reverse geocoding)
   */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodingResponse> {
    return this.request<GeocodingResponse>('/geocode/json', {
      latlng: `${lat},${lng}`,
    });
  }

  // ============================================
  // Places API
  // ============================================

  /**
   * Search for places by text query
   */
  async searchPlaces(query: string, options?: {
    location?: string;
    radius?: number;
    type?: string;
    opennow?: boolean;
  }): Promise<PlacesSearchResponse> {
    return this.request<PlacesSearchResponse>('/place/textsearch/json', {
      query,
      location: options?.location,
      radius: options?.radius,
      type: options?.type,
      opennow: options?.opennow,
    });
  }

  /**
   * Search for places nearby a location
   */
  async nearbySearch(options: NearbySearchRequest): Promise<PlacesSearchResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      location: options.location,
      type: options.type,
      keyword: options.keyword,
      opennow: options.opennow,
    };

    if (options.rankby === 'distance') {
      params.rankby = 'distance';
    } else {
      params.radius = options.radius;
    }

    return this.request<PlacesSearchResponse>('/place/nearbysearch/json', params);
  }

  /**
   * Get details about a place
   */
  async getPlaceDetails(placeId: string, fields?: string[]): Promise<PlaceDetailsResponse> {
    const defaultFields = [
      'name',
      'formatted_address',
      'formatted_phone_number',
      'international_phone_number',
      'website',
      'url',
      'rating',
      'user_ratings_total',
      'price_level',
      'opening_hours',
      'reviews',
      'photos',
      'geometry',
      'types',
      'business_status',
    ];

    return this.request<PlaceDetailsResponse>('/place/details/json', {
      place_id: placeId,
      fields: (fields || defaultFields).join(','),
    });
  }

  /**
   * Autocomplete place search
   */
  async autocomplete(input: string, options?: {
    location?: string;
    radius?: number;
    types?: string;
    components?: string;
  }): Promise<{ predictions: Array<{ description: string; place_id: string; types: string[] }>; status: string }> {
    return this.request('/place/autocomplete/json', {
      input,
      location: options?.location,
      radius: options?.radius,
      types: options?.types,
      components: options?.components,
    });
  }

  // ============================================
  // Directions API
  // ============================================

  /**
   * Get directions between two points
   */
  async getDirections(options: DirectionsRequest): Promise<DirectionsResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      origin: options.origin,
      destination: options.destination,
      mode: options.mode || 'driving',
      alternatives: options.alternatives,
      units: options.units || 'metric',
    };

    if (options.waypoints && options.waypoints.length > 0) {
      params.waypoints = options.waypoints.join('|');
    }

    if (options.avoid && options.avoid.length > 0) {
      params.avoid = options.avoid.join('|');
    }

    if (options.departure_time) {
      params.departure_time = options.departure_time === 'now' ? 'now' : options.departure_time;
    }

    if (options.arrival_time) {
      params.arrival_time = options.arrival_time;
    }

    if (options.traffic_model) {
      params.traffic_model = options.traffic_model;
    }

    return this.request<DirectionsResponse>('/directions/json', params);
  }

  // ============================================
  // Distance Matrix API
  // ============================================

  /**
   * Get travel distance and time for multiple origins and destinations
   */
  async getDistanceMatrix(options: DistanceMatrixRequest): Promise<DistanceMatrixResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      origins: options.origins.join('|'),
      destinations: options.destinations.join('|'),
      mode: options.mode || 'driving',
      units: options.units || 'metric',
    };

    if (options.avoid && options.avoid.length > 0) {
      params.avoid = options.avoid.join('|');
    }

    if (options.departure_time) {
      params.departure_time = options.departure_time === 'now' ? 'now' : options.departure_time;
    }

    if (options.traffic_model) {
      params.traffic_model = options.traffic_model;
    }

    return this.request<DistanceMatrixResponse>('/distancematrix/json', params);
  }

  // ============================================
  // Timezone API
  // ============================================

  /**
   * Get timezone for a location
   */
  async getTimezone(lat: number, lng: number, timestamp?: number): Promise<{
    dstOffset: number;
    rawOffset: number;
    timeZoneId: string;
    timeZoneName: string;
    status: string;
  }> {
    return this.request('/timezone/json', {
      location: `${lat},${lng}`,
      timestamp: timestamp || Math.floor(Date.now() / 1000),
    });
  }

  // ============================================
  // Elevation API
  // ============================================

  /**
   * Get elevation for locations
   */
  async getElevation(locations: Array<{ lat: number; lng: number }>): Promise<{
    results: Array<{
      elevation: number;
      location: { lat: number; lng: number };
      resolution: number;
    }>;
    status: string;
  }> {
    const locationsStr = locations.map(l => `${l.lat},${l.lng}`).join('|');
    return this.request('/elevation/json', { locations: locationsStr });
  }

  // ============================================
  // Static Maps URL Generator
  // ============================================

  /**
   * Generate a static map URL
   */
  getStaticMapUrl(options: {
    center?: string;
    zoom?: number;
    size: string; // e.g., "600x400"
    markers?: Array<{ location: string; color?: string; label?: string }>;
    path?: { points: string[]; color?: string; weight?: number };
    maptype?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
  }): string {
    const url = new URL(`${BASE_URL}/staticmap`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('size', options.size);

    if (options.center) {
      url.searchParams.set('center', options.center);
    }
    if (options.zoom !== undefined) {
      url.searchParams.set('zoom', String(options.zoom));
    }
    if (options.maptype) {
      url.searchParams.set('maptype', options.maptype);
    }

    if (options.markers) {
      for (const marker of options.markers) {
        let markerStr = '';
        if (marker.color) markerStr += `color:${marker.color}|`;
        if (marker.label) markerStr += `label:${marker.label}|`;
        markerStr += marker.location;
        url.searchParams.append('markers', markerStr);
      }
    }

    if (options.path) {
      let pathStr = '';
      if (options.path.color) pathStr += `color:${options.path.color}|`;
      if (options.path.weight) pathStr += `weight:${options.path.weight}|`;
      pathStr += options.path.points.join('|');
      url.searchParams.set('path', pathStr);
    }

    return url.toString();
  }
}
