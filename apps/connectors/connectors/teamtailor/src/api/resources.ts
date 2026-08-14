import type { TeamtailorClient } from './client';
import type {
  ListParams,
  JsonApiListResponse,
  JsonApiSingleResponse,
  JsonApiRelationship,
  JsonApiWriteBody,
} from '../types';

/**
 * Generic JSON:API resource wrapper.
 *
 * Teamtailor exposes every resource (candidates, jobs, job-applications, ...)
 * through the same JSON:API shape, so a single parameterised class covers
 * list/get/create/update/delete for all of them.
 */
export class ResourceApi<A = Record<string, unknown>> {
  /**
   * @param client       shared HTTP client
   * @param path         URL path segment, e.g. `/candidates`
   * @param resourceType JSON:API `type` used in write bodies, e.g. `candidates`
   */
  constructor(
    private readonly client: TeamtailorClient,
    private readonly path: string,
    private readonly resourceType: string
  ) {}

  /** Translate ListParams into JSON:API query parameters. */
  private buildParams(params?: ListParams): Record<string, string | number | boolean | undefined> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (!params) return query;

    if (params.pageNumber !== undefined) query['page[number]'] = params.pageNumber;
    if (params.pageSize !== undefined) query['page[size]'] = params.pageSize;
    if (params.include) query['include'] = params.include;
    if (params.sort) query['sort'] = params.sort;
    if (params.filter) {
      for (const [key, value] of Object.entries(params.filter)) {
        query[`filter[${key}]`] = value;
      }
    }
    return query;
  }

  /** List resources with JSON:API pagination/filtering. */
  async list(params?: ListParams): Promise<JsonApiListResponse<A>> {
    return this.client.get<JsonApiListResponse<A>>(this.path, this.buildParams(params));
  }

  /** Fetch a single resource by id. */
  async get(id: string, params?: Pick<ListParams, 'include'>): Promise<JsonApiSingleResponse<A>> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params?.include) query['include'] = params.include;
    return this.client.get<JsonApiSingleResponse<A>>(
      `${this.path}/${encodeURIComponent(id)}`,
      query
    );
  }

  /** Create a resource from attributes (and optional relationships). */
  async create(
    attributes: Record<string, unknown>,
    relationships?: Record<string, JsonApiRelationship>
  ): Promise<JsonApiSingleResponse<A>> {
    const body: JsonApiWriteBody = {
      data: {
        type: this.resourceType,
        attributes,
        ...(relationships ? { relationships } : {}),
      },
    };
    return this.client.post<JsonApiSingleResponse<A>>(this.path, body);
  }

  /** Update a resource by id (JSON:API PATCH). */
  async update(
    id: string,
    attributes: Record<string, unknown>,
    relationships?: Record<string, JsonApiRelationship>
  ): Promise<JsonApiSingleResponse<A>> {
    const body: JsonApiWriteBody = {
      data: {
        type: this.resourceType,
        id,
        attributes,
        ...(relationships ? { relationships } : {}),
      },
    };
    return this.client.patch<JsonApiSingleResponse<A>>(
      `${this.path}/${encodeURIComponent(id)}`,
      body
    );
  }

  /** Delete a resource by id. */
  async delete(id: string): Promise<void> {
    await this.client.delete<Record<string, never>>(`${this.path}/${encodeURIComponent(id)}`);
  }
}
