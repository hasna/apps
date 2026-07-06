import type { ConnectorClient } from './client';
import type {
  BalanceResponse,
  CreateTaskParams,
  CreateTaskResponse,
  GetTaskResultParams,
  ReportParams,
  ReportResponse,
  TaskResultResponse,
} from '../types';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  async createTask(params: CreateTaskParams): Promise<CreateTaskResponse> {
    const body: Record<string, unknown> = { task: params.task };
    if (params.languagePool !== undefined) body.languagePool = params.languagePool;
    if (params.callbackUrl !== undefined) body.callbackUrl = params.callbackUrl;
    return this.client.post<CreateTaskResponse>('/createTask', body);
  }

  async getTaskResult(params: GetTaskResultParams): Promise<TaskResultResponse> {
    return this.client.post<TaskResultResponse>('/getTaskResult', {
      taskId: params.taskId,
    });
  }

  async getBalance(): Promise<BalanceResponse> {
    return this.client.post<BalanceResponse>('/getBalance');
  }

  async reportCorrect(params: Pick<ReportParams, 'taskId'>): Promise<ReportResponse> {
    return this.client.post<ReportResponse>('/reportCorrect', {
      taskId: params.taskId,
    });
  }

  async reportIncorrect(params: Pick<ReportParams, 'taskId'>): Promise<ReportResponse> {
    return this.client.post<ReportResponse>('/reportIncorrect', {
      taskId: params.taskId,
    });
  }
}
