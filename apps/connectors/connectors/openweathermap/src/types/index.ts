// Weather API Types

// ============================================
// Configuration
// ============================================

export interface WeatherConfig {
  apiKey: string;
  units?: Units;
  lang?: string;
}

export type Units = 'metric' | 'imperial' | 'standard';
export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Coordinates
// ============================================

export interface Coordinates {
  lat: number;
  lon: number;
}

// ============================================
// Current Weather
// ============================================

export interface CurrentWeather {
  coord: Coordinates;
  weather: WeatherCondition[];
  base: string;
  main: MainWeatherData;
  visibility: number;
  wind: WindData;
  clouds: CloudData;
  rain?: PrecipitationData;
  snow?: PrecipitationData;
  dt: number;
  sys: SystemData;
  timezone: number;
  id: number;
  name: string;
  cod: number;
}

export interface WeatherCondition {
  id: number;
  main: string;
  description: string;
  icon: string;
}

export interface MainWeatherData {
  temp: number;
  feels_like: number;
  temp_min: number;
  temp_max: number;
  pressure: number;
  humidity: number;
  sea_level?: number;
  grnd_level?: number;
}

export interface WindData {
  speed: number;
  deg: number;
  gust?: number;
}

export interface CloudData {
  all: number;
}

export interface PrecipitationData {
  '1h'?: number;
  '3h'?: number;
}

export interface SystemData {
  type?: number;
  id?: number;
  country: string;
  sunrise: number;
  sunset: number;
}

// ============================================
// Forecast
// ============================================

export interface ForecastResponse {
  cod: string;
  message: number;
  cnt: number;
  list: ForecastItem[];
  city: CityData;
}

export interface ForecastItem {
  dt: number;
  main: MainWeatherData;
  weather: WeatherCondition[];
  clouds: CloudData;
  wind: WindData;
  visibility: number;
  pop: number; // Probability of precipitation
  rain?: PrecipitationData;
  snow?: PrecipitationData;
  sys: { pod: string }; // Part of day (d/n)
  dt_txt: string;
}

export interface CityData {
  id: number;
  name: string;
  coord: Coordinates;
  country: string;
  population: number;
  timezone: number;
  sunrise: number;
  sunset: number;
}

// ============================================
// Air Pollution
// ============================================

export interface AirPollutionResponse {
  coord: Coordinates;
  list: AirPollutionData[];
}

export interface AirPollutionData {
  main: {
    aqi: number; // Air Quality Index 1-5
  };
  components: AirComponents;
  dt: number;
}

export interface AirComponents {
  co: number;      // Carbon monoxide
  no: number;      // Nitrogen monoxide
  no2: number;     // Nitrogen dioxide
  o3: number;      // Ozone
  so2: number;     // Sulphur dioxide
  pm2_5: number;   // Fine particles
  pm10: number;    // Coarse particles
  nh3: number;     // Ammonia
}

// ============================================
// Geocoding
// ============================================

export interface GeoLocation {
  name: string;
  local_names?: Record<string, string>;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

// ============================================
// One Call API (if subscribed)
// ============================================

export interface OneCallResponse {
  lat: number;
  lon: number;
  timezone: string;
  timezone_offset: number;
  current?: CurrentOneCall;
  minutely?: MinutelyForecast[];
  hourly?: HourlyForecast[];
  daily?: DailyForecast[];
  alerts?: WeatherAlert[];
}

export interface CurrentOneCall {
  dt: number;
  sunrise: number;
  sunset: number;
  temp: number;
  feels_like: number;
  pressure: number;
  humidity: number;
  dew_point: number;
  uvi: number;
  clouds: number;
  visibility: number;
  wind_speed: number;
  wind_deg: number;
  wind_gust?: number;
  weather: WeatherCondition[];
  rain?: PrecipitationData;
  snow?: PrecipitationData;
}

export interface MinutelyForecast {
  dt: number;
  precipitation: number;
}

export interface HourlyForecast extends CurrentOneCall {
  pop: number;
}

export interface DailyForecast {
  dt: number;
  sunrise: number;
  sunset: number;
  moonrise: number;
  moonset: number;
  moon_phase: number;
  summary?: string;
  temp: {
    day: number;
    min: number;
    max: number;
    night: number;
    eve: number;
    morn: number;
  };
  feels_like: {
    day: number;
    night: number;
    eve: number;
    morn: number;
  };
  pressure: number;
  humidity: number;
  dew_point: number;
  wind_speed: number;
  wind_deg: number;
  wind_gust?: number;
  weather: WeatherCondition[];
  clouds: number;
  pop: number;
  rain?: number;
  snow?: number;
  uvi: number;
}

export interface WeatherAlert {
  sender_name: string;
  event: string;
  start: number;
  end: number;
  description: string;
  tags: string[];
}

// ============================================
// API Error Types
// ============================================

export interface WeatherError {
  cod: string | number;
  message: string;
}

export class WeatherApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'WeatherApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
