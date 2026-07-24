import type { ConnectorClient } from './client';
import type { Task, TaskListResult } from '../types';

// ============================================
// Stub Data Generators
// ============================================

function stubTasks(): Task[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'task_stub_001',
      spec_id: 'spec_stub_001',
      title: 'Scaffold auth module',
      status: 'done',
      created_at: now,
    },
    {
      id: 'task_stub_002',
      spec_id: 'spec_stub_001',
      title: 'Wire up token refresh',
      status: 'in_progress',
      created_at: now,
    },
  ];
}

/**
 * Syntropy Tasks API
 * Endpoint: GET /tasks
 */
export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List tasks derived from specs/builds.
   */
  async list(): Promise<TaskListResult> {
    const result = await this.client.request<{ tasks: Task[] }>('/tasks');
    if (result.stub) {
      return { tasks: stubTasks(), stub: true };
    }
    return { tasks: result.data?.tasks ?? [], stub: false };
  }
}
