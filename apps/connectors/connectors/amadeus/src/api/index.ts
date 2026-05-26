import { AmadeusClient, type AmadeusClientConfig } from './client';
import { FlightsApi } from './flights';

export class Amadeus {
  private client: AmadeusClient;
  public readonly flights: FlightsApi;

  constructor(config: AmadeusClientConfig) {
    this.client = new AmadeusClient(config);
    this.flights = new FlightsApi(this.client);
  }

  static fromEnv(): Amadeus {
    const apiKey = process.env.AMADEUS_API_KEY;
    const apiSecret = process.env.AMADEUS_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('AMADEUS_API_KEY and AMADEUS_API_SECRET environment variables are required');
    }

    return new Amadeus({
      apiKey,
      apiSecret,
      environment: process.env.AMADEUS_ENVIRONMENT === 'production' ? 'production' : 'test',
    });
  }

  getEnvironment(): string {
    return this.client.getBaseUrl().includes('test') ? 'test' : 'production';
  }
}

export { AmadeusClient } from './client';
export { FlightsApi } from './flights';
