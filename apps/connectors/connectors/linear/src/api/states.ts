import type { LinearClient } from './client';
import type {
  WorkflowState,
  WorkflowStatesResponse,
  WorkflowStateResponse,
} from '../types';

const STATE_FRAGMENT = `
  fragment StateFragment on WorkflowState {
    id
    name
    color
    type
    position
    description
    archivedAt
    createdAt
    updatedAt
    team {
      id
      name
      key
    }
  }
`;

export class StatesApi {
  constructor(private readonly client: LinearClient) {}

  /**
   * List workflow states for a team
   */
  async listForTeam(
    teamId: string,
    options: { first?: number; after?: string } = {}
  ): Promise<WorkflowState[]> {
    const { first = 50, after } = options;
    const data = await this.client.query<WorkflowStatesResponse>(`
      query TeamWorkflowStates($teamId: String!, $first: Int, $after: String) {
        team(id: $teamId) {
          states(first: $first, after: $after) {
            nodes {
              ...StateFragment
            }
          }
        }
      }
      ${STATE_FRAGMENT}
    `, { teamId, first, after });

    return data.team?.states?.nodes ?? [];
  }

  /**
   * List all workflow states across all teams
   */
  async list(options: { first?: number; after?: string } = {}): Promise<WorkflowState[]> {
    const { first = 100, after } = options;
    const data = await this.client.query<{ workflowStates: { nodes: WorkflowState[] } }>(`
      query WorkflowStates($first: Int, $after: String) {
        workflowStates(first: $first, after: $after) {
          nodes {
            ...StateFragment
          }
        }
      }
      ${STATE_FRAGMENT}
    `, { first, after });

    return data.workflowStates?.nodes ?? [];
  }

  /**
   * Get a workflow state by ID
   */
  async get(id: string): Promise<WorkflowState> {
    const data = await this.client.query<WorkflowStateResponse>(`
      query GetWorkflowState($id: String!) {
        workflowState(id: $id) {
          ...StateFragment
        }
      }
      ${STATE_FRAGMENT}
    `, { id });

    return data.workflowState;
  }
}
