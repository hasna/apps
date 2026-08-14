import type { LinearClient } from './client';
import type { LinearTeam, LinearWorkflowState, TeamsResponse, TeamResponse, ListOptions } from '../types';

const TEAM_FRAGMENT = `
  fragment TeamFragment on Team {
    id
    name
    key
    description
    icon
    color
    private
    createdAt
    updatedAt
  }
`;

const WORKFLOW_STATE_FRAGMENT = `
  fragment WorkflowStateFragment on WorkflowState {
    id
    name
    color
    type
    position
  }
`;

interface WorkflowStatesResponse {
  workflowStates: {
    nodes: LinearWorkflowState[];
  };
}

export class TeamsApi {
  constructor(private readonly client: LinearClient) {}

  /**
   * List all teams
   */
  async list(options: ListOptions = {}): Promise<LinearTeam[]> {
    const { first = 50, after } = options;

    const query = `
      ${TEAM_FRAGMENT}
      query Teams($first: Int, $after: String) {
        teams(first: $first, after: $after) {
          nodes {
            ...TeamFragment
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const result = await this.client.query<TeamsResponse>(query, {
      first,
      after,
    });

    return result.teams.nodes;
  }

  /**
   * Get a single team by ID
   */
  async get(id: string): Promise<LinearTeam> {
    const query = `
      ${TEAM_FRAGMENT}
      query Team($id: String!) {
        team(id: $id) {
          ...TeamFragment
        }
      }
    `;

    const result = await this.client.query<TeamResponse>(query, { id });
    return result.team;
  }

  /**
   * Find team by key (e.g., "ENG", "DES")
   */
  async findByKey(key: string): Promise<LinearTeam | undefined> {
    const teams = await this.list();
    return teams.find(t => t.key.toLowerCase() === key.toLowerCase());
  }

  /**
   * Find team by name
   */
  async findByName(name: string): Promise<LinearTeam | undefined> {
    const teams = await this.list();
    return teams.find(t => t.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Get workflow states for a team
   */
  async getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
    const query = `
      ${WORKFLOW_STATE_FRAGMENT}
      query WorkflowStates($teamId: String!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            ...WorkflowStateFragment
          }
        }
      }
    `;

    const result = await this.client.query<WorkflowStatesResponse>(query, { teamId });
    return result.workflowStates.nodes;
  }

  /**
   * Get a specific workflow state by name for a team
   */
  async findWorkflowState(teamId: string, stateName: string): Promise<LinearWorkflowState | undefined> {
    const states = await this.getWorkflowStates(teamId);
    return states.find(s => s.name.toLowerCase() === stateName.toLowerCase());
  }
}
