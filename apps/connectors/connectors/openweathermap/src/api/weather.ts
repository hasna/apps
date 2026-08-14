import type { OpenWeatherMapClient } from './client';
import type {
  CurrentWeather,
  ForecastResponse,
  AirPollutionResponse,
  GeoLocation,
  OneCallResponse,
} from '../types';

export class WeatherApi {
  constructor(private readonly client: OpenWeatherMapClient) {}

  /**
   * Get current weather by city name
   */
  async getCurrentByCity(city: string, countryCode?: string): Promise<CurrentWeather> {
    const q = countryCode ? `${city},${countryCode}` : city;
    return this.client.get<CurrentWeather>('/data/2.5/weather', { q });
  }

  /**
   * Get current weather by coordinates
   */
  async getCurrentByCoords(lat: number, lon: number): Promise<CurrentWeather> {
    return this.client.get<CurrentWeather>('/data/2.5/weather', { lat, lon });
  }

  /**
   * Get current weather by city ID
   */
  async getCurrentById(cityId: number): Promise<CurrentWeather> {
    return this.client.get<CurrentWeather>('/data/2.5/weather', { id: cityId });
  }

  /**
   * Get current weather by ZIP code
   */
  async getCurrentByZip(zip: string, countryCode: string = 'US'): Promise<CurrentWeather> {
    return this.client.get<CurrentWeather>('/data/2.5/weather', { zip: `${zip},${countryCode}` });
  }

  /**
   * Get 5-day/3-hour forecast by city name
   */
  async getForecastByCity(city: string, countryCode?: string, cnt?: number): Promise<ForecastResponse> {
    const q = countryCode ? `${city},${countryCode}` : city;
    return this.client.get<ForecastResponse>('/data/2.5/forecast', { q, cnt });
  }

  /**
   * Get 5-day/3-hour forecast by coordinates
   */
  async getForecastByCoords(lat: number, lon: number, cnt?: number): Promise<ForecastResponse> {
    return this.client.get<ForecastResponse>('/data/2.5/forecast', { lat, lon, cnt });
  }

  /**
   * Get air pollution data by coordinates
   */
  async getAirPollution(lat: number, lon: number): Promise<AirPollutionResponse> {
    return this.client.get<AirPollutionResponse>('/data/2.5/air_pollution', { lat, lon });
  }

  /**
   * Get air pollution forecast by coordinates
   */
  async getAirPollutionForecast(lat: number, lon: number): Promise<AirPollutionResponse> {
    return this.client.get<AirPollutionResponse>('/data/2.5/air_pollution/forecast', { lat, lon });
  }

  /**
   * Get coordinates by city name (geocoding)
   */
  async geocode(city: string, countryCode?: string, limit: number = 5): Promise<GeoLocation[]> {
    const q = countryCode ? `${city},${countryCode}` : city;
    return this.client.get<GeoLocation[]>('/geo/1.0/direct', { q, limit });
  }

  /**
   * Get location by coordinates (reverse geocoding)
   */
  async reverseGeocode(lat: number, lon: number, limit: number = 5): Promise<GeoLocation[]> {
    return this.client.get<GeoLocation[]>('/geo/1.0/reverse', { lat, lon, limit });
  }

  /**
   * Get coordinates by ZIP code
   */
  async geocodeByZip(zip: string, countryCode: string = 'US'): Promise<GeoLocation> {
    return this.client.get<GeoLocation>('/geo/1.0/zip', { zip: `${zip},${countryCode}` });
  }

  /**
   * Get One Call API data (requires subscription for some features)
   * Includes current, minutely, hourly, daily forecasts and alerts
   */
  async getOneCall(
    lat: number,
    lon: number,
    exclude?: ('current' | 'minutely' | 'hourly' | 'daily' | 'alerts')[]
  ): Promise<OneCallResponse> {
    return this.client.get<OneCallResponse>('/data/3.0/onecall', {
      lat,
      lon,
      exclude: exclude?.join(','),
    });
  }
}
