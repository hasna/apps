// OpenWeatherMap Connector - SDK Entry Point

export { OpenWeatherMap, OpenWeatherMapClient, WeatherApi } from './api';

export type {
  WeatherConfig,
  Units,
  OutputFormat,
  Coordinates,
  CurrentWeather,
  WeatherCondition,
  MainWeatherData,
  WindData,
  CloudData,
  PrecipitationData,
  SystemData,
  ForecastResponse,
  ForecastItem,
  CityData,
  AirPollutionResponse,
  AirPollutionData,
  AirComponents,
  GeoLocation,
  OneCallResponse,
  CurrentOneCall,
  MinutelyForecast,
  HourlyForecast,
  DailyForecast,
  WeatherAlert,
  WeatherError,
} from './types';

export { WeatherApiError } from './types';
