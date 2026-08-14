import type { DeployAgentParams, ListAgentsParams } from '../types';
import { normalizeQueryParams, omitUndefined, pickArg } from '../types';
import type { ConnectorClient } from './client';

export class AgentsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params: ListAgentsParams = {}): Promise<unknown> {
    return this.client.get('/agents', normalizeQueryParams(params as Record<string, unknown>));
  }

  get(agentId: string): Promise<unknown> {
    if (!agentId) {
      throw new Error('agent_id is required');
    }
    return this.client.get(`/agents/${encodeURIComponent(agentId)}`);
  }

  getByName(namespaceSlug: string, agentName: string): Promise<unknown> {
    if (!namespaceSlug || !agentName) {
      throw new Error('namespace_slug and agent_name are required');
    }
    return this.client.get(
      `/agents/name/${encodeURIComponent(namespaceSlug)}/${encodeURIComponent(agentName)}`
    );
  }

  deploy(params: DeployAgentParams): Promise<unknown> {
    const body = omitUndefined({
      agent_name: pickArg<string>(params as Record<string, unknown>, 'agent_name', 'agentName'),
      version_id: pickArg<string>(params as Record<string, unknown>, 'version_id', 'versionId'),
      branch: params.branch,
      author_name: pickArg<string>(params as Record<string, unknown>, 'author_name', 'authorName'),
      author_email: pickArg<string>(params as Record<string, unknown>, 'author_email', 'authorEmail'),
      commit_message: pickArg<string>(params as Record<string, unknown>, 'commit_message', 'commitMessage'),
      commit_sha: pickArg<string>(params as Record<string, unknown>, 'commit_sha', 'commitSha'),
      are_tasks_sticky: pickArg<boolean>(params as Record<string, unknown>, 'are_tasks_sticky', 'areTasksSticky'),
      acp_type: pickArg<string>(params as Record<string, unknown>, 'acp_type', 'acpType'),
    });

    if (!body.agent_name) {
      throw new Error('agent_name is required');
    }

    return this.client.post('/agents/deploy', body);
  }
}
