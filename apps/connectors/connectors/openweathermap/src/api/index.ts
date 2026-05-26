import type { WeatherConfig } from '../types';
import { OpenWeatherMapClient } from './client';
import { WeatherApi } from './weather';

export class OpenWeatherMap {
  public readonly weather: WeatherApi;
  private readonly client: OpenWeatherMapClient;

  constructor(config: WeatherConfig) {
    this.client = new OpenWeatherMapClient(config);
    this.weather = new WeatherApi(this.client);
  }

  getUnitSymbol(type: 'temp' | 'speed'): string {
    return this.client.getUnitSymbol(type);
  }

  getUnits() {
    return this.client.getUnits();
  }
}

export { OpenWeatherMapClient } from './client';
export { WeatherApi } from './weather';
