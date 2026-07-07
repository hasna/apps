import type { ConnectorClient } from './client';
import type { Patient, PatientListParams, ListResponse } from '../types';

export class PatientsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: PatientListParams): Promise<ListResponse<Patient>> {
    return this.client.get<ListResponse<Patient>>('/patients', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: string): Promise<Patient> {
    return this.client.get<Patient>(`/patients/${encodeURIComponent(id)}`);
  }
}
