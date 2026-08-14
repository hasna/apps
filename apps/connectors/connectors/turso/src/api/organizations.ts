import type { TursoClient } from './client';
import type { Organization } from '../types';

export class OrganizationsApi {
  constructor(private readonly client: TursoClient) {}

  list(): Promise<Organization[]> {
    return this.client.get<Organization[]>('/organizations');
  }

  validateToken(): Promise<{ exp: number }> {
    return this.client.get<{ exp: number }>('/auth/validate');
  }
}
