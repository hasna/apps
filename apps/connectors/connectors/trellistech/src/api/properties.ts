import type {
  CreatePropertyRequest,
  DeletePropertyResponse,
  GetPropertyResponse,
  ListPropertiesParams,
  ListPropertiesResponse,
  MutatePropertyResponse,
  Property,
  UpdatePropertyRequest,
} from '../types';
import type { TrellistechClient } from './client';

export class PropertiesApi {
  constructor(private readonly client: TrellistechClient) {}

  private basePath(): string {
    return this.client.workspacePath('/properties');
  }

  async list(params?: ListPropertiesParams): Promise<ListPropertiesResponse> {
    return this.client.get<ListPropertiesResponse>(this.basePath(), params);
  }

  async get(propertyId: string): Promise<Property> {
    const response = await this.client.get<GetPropertyResponse>(
      `${this.basePath()}/${encodeURIComponent(propertyId)}`
    );
    return response.property;
  }

  async create(body: CreatePropertyRequest): Promise<Property> {
    const response = await this.client.post<MutatePropertyResponse>(this.basePath(), body);
    return response.property;
  }

  async update(propertyId: string, body: UpdatePropertyRequest): Promise<Property> {
    const response = await this.client.patch<MutatePropertyResponse>(
      `${this.basePath()}/${encodeURIComponent(propertyId)}`,
      body
    );
    return response.property;
  }

  async replace(propertyId: string, body: UpdatePropertyRequest): Promise<Property> {
    const response = await this.client.put<MutatePropertyResponse>(
      `${this.basePath()}/${encodeURIComponent(propertyId)}`,
      body
    );
    return response.property;
  }

  async delete(propertyId: string): Promise<DeletePropertyResponse> {
    return this.client.delete<DeletePropertyResponse>(
      `${this.basePath()}/${encodeURIComponent(propertyId)}`
    );
  }
}
