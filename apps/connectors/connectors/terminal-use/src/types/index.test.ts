import { describe, test, expect } from 'bun:test';
import { pickArg, normalizeQueryParams, parseApiError, ConnectorApiError } from './index';

describe('type helpers', () => {
  test('pickArg prefers first defined alias', () => {
    expect(pickArg({ namespace_id: 'a', namespaceId: 'b' }, 'namespace_id', 'namespaceId')).toBe('a');
    expect(pickArg({ namespaceId: 'b' }, 'namespace_id', 'namespaceId')).toBe('b');
  });

  test('normalizeQueryParams maps camelCase to snake_case query keys', () => {
    expect(normalizeQueryParams({
      namespaceId: 'ns',
      pageNumber: 2,
      agentId: 'a1',
      taskId: 't1',
      projectId: 'p1',
    })).toEqual({
      namespace_id: 'ns',
      page_number: 2,
      agent_id: 'a1',
      task_id: 't1',
      project_id: 'p1',
    });
  });

  test('parseApiError builds ConnectorApiError from JSON body', () => {
    const err = parseApiError({ message: 'Bad request' }, 400);
    expect(err).toBeInstanceOf(ConnectorApiError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad request');
  });
});
