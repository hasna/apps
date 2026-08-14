export type OutputFormat = 'json' | 'pretty';

export interface GoogleMapsConfig {
  apiKey: string;
}

// Geocoding Types
export interface GeocodingResult {
  formatted_address: string;
  geometry: {
    location: LatLng;
    location_type: string;
    viewport: {
      northeast: LatLng;
      southwest: LatLng;
    };
  };
  place_id: string;
  address_components: AddressComponent[];
  types: string[];
}

export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodingResponse {
  results: GeocodingResult[];
  status: string;
  error_message?: string;
}

// Places Types
export interface Place {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry: {
    location: LatLng;
    viewport?: {
      northeast: LatLng;
      southwest: LatLng;
    };
  };
  types: string[];
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  opening_hours?: {
    open_now: boolean;
    weekday_text?: string[];
  };
  photos?: PlacePhoto[];
  vicinity?: string;
  business_status?: string;
}

export interface PlacePhoto {
  photo_reference: string;
  height: number;
  width: number;
  html_attributions: string[];
}

export interface PlaceDetails extends Place {
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  url?: string;
  reviews?: PlaceReview[];
  address_components?: AddressComponent[];
  utc_offset?: number;
}

export interface PlaceReview {
  author_name: string;
  rating: number;
  text: string;
  time: number;
  relative_time_description: string;
}

export interface PlacesSearchResponse {
  results: Place[];
  status: string;
  error_message?: string;
  next_page_token?: string;
}

export interface PlaceDetailsResponse {
  result: PlaceDetails;
  status: string;
  error_message?: string;
}

// Directions Types
export interface DirectionsRequest {
  origin: string;
  destination: string;
  mode?: TravelMode;
  waypoints?: string[];
  alternatives?: boolean;
  avoid?: AvoidType[];
  units?: 'metric' | 'imperial';
  departure_time?: number | 'now';
  arrival_time?: number;
  traffic_model?: 'best_guess' | 'pessimistic' | 'optimistic';
}

export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit';
export type AvoidType = 'tolls' | 'highways' | 'ferries' | 'indoor';

export interface DirectionsRoute {
  summary: string;
  legs: DirectionsLeg[];
  overview_polyline: {
    points: string;
  };
  bounds: {
    northeast: LatLng;
    southwest: LatLng;
  };
  copyrights: string;
  warnings: string[];
  waypoint_order: number[];
}

export interface DirectionsLeg {
  start_address: string;
  end_address: string;
  start_location: LatLng;
  end_location: LatLng;
  distance: TextValue;
  duration: TextValue;
  duration_in_traffic?: TextValue;
  steps: DirectionsStep[];
  arrival_time?: TimeValue;
  departure_time?: TimeValue;
}

export interface DirectionsStep {
  travel_mode: string;
  start_location: LatLng;
  end_location: LatLng;
  polyline: {
    points: string;
  };
  duration: TextValue;
  distance: TextValue;
  html_instructions: string;
  maneuver?: string;
  transit_details?: TransitDetails;
}

export interface TransitDetails {
  arrival_stop: {
    name: string;
    location: LatLng;
  };
  departure_stop: {
    name: string;
    location: LatLng;
  };
  arrival_time: TimeValue;
  departure_time: TimeValue;
  headsign: string;
  num_stops: number;
  line: {
    name: string;
    short_name: string;
    color?: string;
    vehicle: {
      name: string;
      type: string;
      icon?: string;
    };
  };
}

export interface TextValue {
  text: string;
  value: number;
}

export interface TimeValue {
  text: string;
  value: number;
  time_zone: string;
}

export interface DirectionsResponse {
  routes: DirectionsRoute[];
  status: string;
  error_message?: string;
  geocoded_waypoints?: {
    geocoder_status: string;
    place_id: string;
    types: string[];
  }[];
}

// Distance Matrix Types
export interface DistanceMatrixRequest {
  origins: string[];
  destinations: string[];
  mode?: TravelMode;
  avoid?: AvoidType[];
  units?: 'metric' | 'imperial';
  departure_time?: number | 'now';
  traffic_model?: 'best_guess' | 'pessimistic' | 'optimistic';
}

export interface DistanceMatrixResponse {
  origin_addresses: string[];
  destination_addresses: string[];
  rows: DistanceMatrixRow[];
  status: string;
  error_message?: string;
}

export interface DistanceMatrixRow {
  elements: DistanceMatrixElement[];
}

export interface DistanceMatrixElement {
  status: string;
  duration: TextValue;
  duration_in_traffic?: TextValue;
  distance: TextValue;
}

// Nearby Search Types
export interface NearbySearchRequest {
  location: string; // lat,lng
  radius: number; // meters, max 50000
  type?: string;
  keyword?: string;
  rankby?: 'prominence' | 'distance';
  opennow?: boolean;
}

// Text Search Types
export interface TextSearchRequest {
  query: string;
  location?: string;
  radius?: number;
  type?: string;
  opennow?: boolean;
}

// Error type
export class GoogleMapsError extends Error {
  constructor(
    message: string,
    public status: string,
    public details?: string
  ) {
    super(message);
    this.name = 'GoogleMapsError';
  }
}
