import type { ConnectorConfig } from '../types';
import { ConnectorClient, type RequestOptions } from './client';
import { PatientsApi } from './patients';
import { AppointmentsApi } from './appointments';
import { TreatmentsApi } from './treatments';
import { ChartsApi } from './charts';
import { InventoryApi } from './inventory';
import { LeadsApi } from './leads';

export class Tepali {
  private readonly client: ConnectorClient;

  public readonly patients: PatientsApi;
  public readonly appointments: AppointmentsApi;
  public readonly treatments: TreatmentsApi;
  public readonly charts: ChartsApi;
  public readonly inventory: InventoryApi;
  public readonly leads: LeadsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.patients = new PatientsApi(this.client);
    this.appointments = new AppointmentsApi(this.client);
    this.treatments = new TreatmentsApi(this.client);
    this.charts = new ChartsApi(this.client);
    this.inventory = new InventoryApi(this.client);
    this.leads = new LeadsApi(this.client);
  }

  static fromEnv(): Tepali {
    const apiKey = process.env.TEPALI_API_KEY;
    if (!apiKey) {
      throw new Error('TEPALI_API_KEY environment variable is required');
    }
    return new Tepali({ apiKey, baseUrl: process.env.TEPALI_BASE_URL });
  }

  /**
   * Perform an arbitrary authenticated request against the Tepali API.
   * Useful for endpoints not yet wrapped by a dedicated resource module.
   */
  async raw<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.client.request<T>(path, options);
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL, type RequestOptions } from './client';
export { PatientsApi } from './patients';
export { AppointmentsApi } from './appointments';
export { TreatmentsApi } from './treatments';
export { ChartsApi } from './charts';
export { InventoryApi } from './inventory';
export { LeadsApi } from './leads';
