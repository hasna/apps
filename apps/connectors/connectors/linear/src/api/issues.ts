import type { LinearClient } from './client';
import type {
  LinearIssue,
  IssueListOptions,
  CreateIssueInput,
  UpdateIssueInput,
  IssuesResponse,
  IssueResponse,
  CreateIssueResponse,
  UpdateIssueResponse,
  ArchiveIssueResponse,
  IssueFilter,
} from '../types';

const ISSUE_FRAGMENT = `
  fragment IssueFragment on Issue {
    id
    identifier
    title
    description
    priority
    priorityLabel
    estimate
    sortOrder
    boardOrder
    startedAt
    completedAt
    canceledAt
    dueDate
    createdAt
    updatedAt
    archivedAt
    url
    number
    team {
      id
      name
      key
    }
    state {
      id
      name
      color
      type
    }
    assignee {
      id
      name
      displayName
      email
    }
    creator {
      id
      name
      displayName
    }
    labels {
      nodes {
        id
        name
        color
      }
    }
    project {
      id
      name
    }
  }
`;

export class IssuesApi {
  constructor(private readonly client: LinearClient) {}

  /**
   * List issues with optional filters
   */
  async list(options: IssueListOptions = {}): Promise<LinearIssue[]> {
    const { first = 50, after, teamId, projectId, assigneeId, filter } = options;

    // Build filter object
    const filterObj: IssueFilter = filter || {};
    if (teamId) {
      filterObj.team = { id: { eq: teamId } };
    }
    if (projectId) {
      filterObj.project = { id: { eq: projectId } };
    }
    if (assigneeId) {
      filterObj.assignee = { id: { eq: assigneeId } };
    }

    const query = `
      ${ISSUE_FRAGMENT}
      query Issues($first: Int, $after: String, $filter: IssueFilter) {
        issues(first: $first, after: $after, filter: $filter) {
          nodes {
            ...IssueFragment
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const result = await this.client.query<IssuesResponse>(query, {
      first,
      after,
      filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
    });

    return result.issues.nodes;
  }

  /**
   * Get a single issue by ID
   */
  async get(id: string): Promise<LinearIssue> {
    const query = `
      ${ISSUE_FRAGMENT}
      query Issue($id: String!) {
        issue(id: $id) {
          ...IssueFragment
        }
      }
    `;

    const result = await this.client.query<IssueResponse>(query, { id });
    return result.issue;
  }

  /**
   * Create a new issue
   */
  async create(input: CreateIssueInput): Promise<LinearIssue> {
    const mutation = `
      ${ISSUE_FRAGMENT}
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            ...IssueFragment
          }
        }
      }
    `;

    const result = await this.client.mutate<CreateIssueResponse>(mutation, {
      input,
    });

    if (!result.issueCreate.success || !result.issueCreate.issue) {
      throw new Error('Failed to create issue');
    }

    return result.issueCreate.issue;
  }

  /**
   * Update an existing issue
   */
  async update(id: string, input: UpdateIssueInput): Promise<LinearIssue> {
    const mutation = `
      ${ISSUE_FRAGMENT}
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            ...IssueFragment
          }
        }
      }
    `;

    const result = await this.client.mutate<UpdateIssueResponse>(mutation, {
      id,
      input,
    });

    if (!result.issueUpdate.success || !result.issueUpdate.issue) {
      throw new Error('Failed to update issue');
    }

    return result.issueUpdate.issue;
  }

  /**
   * Archive an issue (soft delete)
   */
  async archive(id: string): Promise<boolean> {
    const mutation = `
      mutation ArchiveIssue($id: String!) {
        issueArchive(id: $id) {
          success
        }
      }
    `;

    const result = await this.client.mutate<ArchiveIssueResponse>(mutation, { id });
    return result.issueArchive.success;
  }

  /**
   * Change issue state by state ID
   */
  async changeState(id: string, stateId: string): Promise<LinearIssue> {
    return this.update(id, { stateId });
  }

  /**
   * Assign issue to a user
   */
  async assign(id: string, assigneeId: string): Promise<LinearIssue> {
    return this.update(id, { assigneeId });
  }

  /**
   * Add issue to a project
   */
  async addToProject(id: string, projectId: string): Promise<LinearIssue> {
    return this.update(id, { projectId });
  }

  /**
   * Search issues by query text
   */
  async search(query: string, first = 20): Promise<LinearIssue[]> {
    const gqlQuery = `
      ${ISSUE_FRAGMENT}
      query SearchIssues($query: String!, $first: Int) {
        issueSearch(query: $query, first: $first) {
          nodes {
            ...IssueFragment
          }
        }
      }
    `;

    const result = await this.client.query<{ issueSearch: { nodes: LinearIssue[] } }>(
      gqlQuery,
      { query, first }
    );

    return result.issueSearch.nodes;
  }
}
