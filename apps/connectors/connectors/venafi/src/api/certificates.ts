import type { ConnectorClient } from './client';
import type { Certificate, CertificateListParams, CreateCertificateParams } from '../types';

export class CertificatesApi {
  constructor(private readonly client: ConnectorClient) {}

  /** GET /certificates */
  async list(params?: CertificateListParams): Promise<unknown> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit !== undefined) query.limit = params.limit;
    if (params?.offset !== undefined) query.offset = params.offset;
    return this.client.get('/certificates', query);
  }

  /** GET /certificates/{id} */
  async get(certificateId: string): Promise<Certificate> {
    return this.client.get<Certificate>(`/certificates/${encodeURIComponent(certificateId)}`);
  }

  /** POST /certificates */
  async create(body: CreateCertificateParams): Promise<unknown> {
    return this.client.post('/certificates', body);
  }
}
