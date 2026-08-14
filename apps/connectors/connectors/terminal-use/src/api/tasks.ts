import type { CreateTaskParams, ListTasksParams, SendTaskEventParams } from '../types';
import { normalizeQueryParams, omitUndefined, pickArg } from '../types';
import type { ConnectorClient } from './client';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params: ListTasksParams = {}): Promise<unknown> {
    return this.client.get('/tasks', normalizeQueryParams(params as Record<string, unknown>));
  }

  create(params: CreateTaskParams): Promise<unknown> {
    const body = omitUndefined({
      agent_id: pickArg<string>(params as Record<string, unknown>, 'agent_id', 'agentId'),
      agent_name: pickArg<string>(params as Record<string, unknown>, 'agent_name', 'agentName'),
      branch: params.branch,
      filesystem_id: pickArg<string>(params as Record<string, unknown>, 'filesystem_id', 'filesystemId'),
      name: params.name,
    });

    return this.client.post('/tasks', body);
  }

  get(taskId: string): Promise<unknown> {
    if (!taskId) {
      throw new Error('task_id is required');
    }
    return this.client.get(`/tasks/${encodeURIComponent(taskId)}`);
  }

  cancel(taskId: string): Promise<unknown> {
    if (!taskId) {
      throw new Error('task_id is required');
    }
    return this.client.post(`/tasks/${encodeURIComponent(taskId)}/cancel`);
  }

  sendTextEvent(taskId: string, params: SendTaskEventParams = {}): Promise<unknown> {
    return this.sendEvent(taskId, {
      type: 'text',
      text: params.text ?? '',
    }, params);
  }

  sendDataEvent(taskId: string, params: SendTaskEventParams = {}): Promise<unknown> {
    return this.sendEvent(taskId, {
      type: 'data',
      data: params.data,
    }, params);
  }

  private sendEvent(
    taskId: string,
    content: { type: 'text'; text: string } | { type: 'data'; data: unknown },
    params: SendTaskEventParams
  ): Promise<unknown> {
    if (!taskId) {
      throw new Error('task_id is required');
    }

    const body = omitUndefined({
      content,
      idempotency_key: pickArg<string>(params as Record<string, unknown>, 'idempotency_key', 'idempotencyKey'),
      persist_message: pickArg<boolean>(params as Record<string, unknown>, 'persist_message', 'persistMessage'),
    });

    return this.client.post(`/tasks/${encodeURIComponent(taskId)}/events`, body);
  }

  async stream(taskId: string): Promise<Response> {
    if (!taskId) {
      throw new Error('task_id is required');
    }
    return this.client.stream(`/tasks/${encodeURIComponent(taskId)}/stream`);
  }
}
