import type { WatiClient } from './client';
import type {
  AssignOperatorParams,
  UnassignOperatorParams,
  UpdateChatStatusParams,
  WatiApiResponse,
} from '../types';

export class OperatorsApi {
  constructor(private readonly client: WatiClient) {}

  async assignOperator(params: AssignOperatorParams): Promise<WatiApiResponse> {
    const { whatsappNumber, email } = params;
    return this.client.post<WatiApiResponse>(
      '/api/v1/assignOperator',
      { email },
      { whatsappNumber },
    );
  }

  async unassignOperator(params: UnassignOperatorParams): Promise<WatiApiResponse> {
    return this.client.post<WatiApiResponse>(
      '/api/v1/unassignOperator',
      undefined,
      { whatsappNumber: params.whatsappNumber },
    );
  }

  async getOperators(): Promise<WatiApiResponse> {
    return this.client.get<WatiApiResponse>('/api/v1/getOperators');
  }

  async updateChatStatus(params: UpdateChatStatusParams): Promise<WatiApiResponse> {
    const { whatsappNumber, status } = params;
    return this.client.post<WatiApiResponse>(
      `/api/v1/updateChatStatus/${encodeURIComponent(whatsappNumber)}`,
      { status },
    );
  }
}
