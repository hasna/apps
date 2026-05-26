// Amilia Connector — Activity registration and recreation management
import { AmiliaClient } from './client';
import type { AmiliaConfig, AmiliaActivity, AmiliaActivityList, AmiliaPerson, AmiliaRegistration, AmiliaLocation, AmiliaCategory } from '../types';
export { AmiliaClient } from './client';

export class Amilia {
  private readonly client: AmiliaClient;
  constructor(config: AmiliaConfig) { this.client = new AmiliaClient(config); }
  static fromEnv(): Amilia {
    const token = process.env.AMILIA_TOKEN;
    const organizationId = process.env.AMILIA_ORG_ID;
    if (!token || !organizationId) throw new Error('AMILIA_TOKEN and AMILIA_ORG_ID are required');
    return new Amilia({ token, organizationId });
  }

  async listActivities(options?: { page?: number; perPage?: number; categoryId?: number }): Promise<AmiliaActivityList> {
    return this.client.request<AmiliaActivityList>('/activities', { params: { page: options?.page, perPage: options?.perPage, categoryId: options?.categoryId } });
  }
  async getActivity(activityId: number): Promise<AmiliaActivity> { return this.client.request<AmiliaActivity>(`/activities/${activityId}`); }

  async listPersons(options?: { page?: number; perPage?: number }): Promise<AmiliaPerson[]> {
    return this.client.request<AmiliaPerson[]>('/persons', { params: { page: options?.page, perPage: options?.perPage } });
  }
  async getPerson(personId: number): Promise<AmiliaPerson> { return this.client.request<AmiliaPerson>(`/persons/${personId}`); }
  async searchPersons(query: string): Promise<AmiliaPerson[]> { return this.client.request<AmiliaPerson[]>('/persons/search', { params: { q: query } }); }

  async listRegistrations(activityId: number): Promise<AmiliaRegistration[]> { return this.client.request<AmiliaRegistration[]>(`/activities/${activityId}/registrations`); }
  async getRegistration(registrationId: number): Promise<AmiliaRegistration> { return this.client.request<AmiliaRegistration>(`/registrations/${registrationId}`); }

  async listLocations(): Promise<AmiliaLocation[]> { return this.client.request<AmiliaLocation[]>('/locations'); }
  async listCategories(): Promise<AmiliaCategory[]> { return this.client.request<AmiliaCategory[]>('/categories'); }

  getClient(): AmiliaClient { return this.client; }
}
