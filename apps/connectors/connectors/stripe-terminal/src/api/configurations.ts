import type { ConnectorClient } from './client';
import type {
  TerminalConfiguration,
  TerminalConfigurationCreateParams,
  TerminalConfigurationUpdateParams,
  TerminalConfigurationListOptions,
  StripeList,
  DeletedObject,
} from '../types';

/**
 * Stripe Terminal Configurations API
 * https://stripe.com/docs/api/terminal/configuration
 */
export class ConfigurationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params?: TerminalConfigurationCreateParams): Promise<TerminalConfiguration> {
    return this.client.post<TerminalConfiguration>('/terminal/configurations', params ?? {});
  }

  async get(id: string): Promise<TerminalConfiguration> {
    return this.client.get<TerminalConfiguration>(`/terminal/configurations/${id}`);
  }

  async update(id: string, params: TerminalConfigurationUpdateParams): Promise<TerminalConfiguration> {
    return this.client.post<TerminalConfiguration>(`/terminal/configurations/${id}`, params);
  }

  async list(options?: TerminalConfigurationListOptions): Promise<StripeList<TerminalConfiguration>> {
    return this.client.get<StripeList<TerminalConfiguration>>('/terminal/configurations', options as Record<string, string | number | boolean | undefined>);
  }

  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/terminal/configurations/${id}`);
  }
}
