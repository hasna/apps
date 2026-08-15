import type { CreateProjectParams, ListProjectsParams } from '../types';
import { normalizeQueryParams, omitUndefined, pickArg } from '../types';
import type { ConnectorClient } from './client';

export class ProjectsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params: ListProjectsParams = {}): Promise<unknown> {
    return this.client.get('/projects', normalizeQueryParams(params as Record<string, unknown>));
  }

  create(params: CreateProjectParams): Promise<unknown> {
    const body = omitUndefined({
      namespace_id: pickArg<string>(params as unknown as Record<string, unknown>, 'namespace_id', 'namespaceId'),
      name: params.name,
      description: params.description,
    });

    if (!body.namespace_id) {
      throw new Error('namespace_id is required');
    }
    if (!body.name) {
      throw new Error('name is required');
    }

    return this.client.post('/projects', body);
  }
}
