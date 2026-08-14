import type { CreateServicingTaskRequest } from '../types';
import { encodePathSegment, type ZolvoClient } from './client';

export async function createServicingTask(
  client: ZolvoClient,
  loanId: string,
  body: CreateServicingTaskRequest = {},
): Promise<Record<string, unknown>> {
  return client.post<Record<string, unknown>>(
    `/loans/${encodePathSegment(loanId)}/tasks`,
    body,
  );
}
