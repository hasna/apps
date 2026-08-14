import type { VantaClient } from './client';
import type {
  Control,
  CreateControlInput,
  ListControlsParams,
  PaginatedResponse,
} from '../types';

export class ControlsApi {
  constructor(private readonly client: VantaClient) {}

  list(params: ListControlsParams = {}): Promise<PaginatedResponse<Control>> {
    return this.client.get<PaginatedResponse<Control>>('/controls', {
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
      frameworkMatchesAny: params.frameworkMatchesAny,
    });
  }

  get(controlId: string): Promise<Control> {
    return this.client.get<Control>('/controls/' + encodeURIComponent(controlId));
  }

  create(input: CreateControlInput): Promise<Control> {
    return this.client.post<Control>('/controls', input as unknown as Record<string, unknown>);
  }
}
