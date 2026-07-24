import type {
  CreateMachineRequest,
  ExecRequest,
  ExecResponse,
  Machine,
  RawRequestOptions,
} from '../types';
import { SmolMachinesClient } from './client';

function encodeMachineName(name: string): string {
  return encodeURIComponent(name);
}

export class MachinesApi {
  constructor(private readonly client: SmolMachinesClient) {}

  async list(): Promise<Machine[]> {
    const result = await this.client.get<Machine[] | { machines?: Machine[] }>('/machines');
    if (Array.isArray(result)) {
      return result;
    }
    return result.machines ?? [];
  }

  async create(request: CreateMachineRequest): Promise<Machine> {
    return this.client.post<Machine>('/machines', request);
  }

  async get(name: string): Promise<Machine> {
    return this.client.get<Machine>(`/machines/${encodeMachineName(name)}`);
  }

  async start(name: string): Promise<Machine> {
    return this.client.post<Machine>(`/machines/${encodeMachineName(name)}/start`);
  }

  async stop(name: string): Promise<Machine> {
    return this.client.post<Machine>(`/machines/${encodeMachineName(name)}/stop`);
  }

  async exec(name: string, request: ExecRequest): Promise<ExecResponse> {
    return this.client.post<ExecResponse>(`/machines/${encodeMachineName(name)}/exec`, request);
  }

  async delete(name: string): Promise<void> {
    await this.client.delete(`/machines/${encodeMachineName(name)}`);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}
