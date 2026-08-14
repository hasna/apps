import type { WandbClient } from './client';
import type { ProjectRunsOptions, ProjectRunsResponse } from '../types';

const PROJECT_RUNS_QUERY = `query ProjectRuns($entity: String!, $project: String!, $first: Int, $order: String, $filters: JSONString) {
  project(name: $project, entityName: $entity) {
    runs(first: $first, order: $order, filters: $filters) {
      edges {
        node {
          id
          name
          displayName
          state
          createdAt
          summaryMetrics
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}`;

export class ProjectsApi {
  constructor(private readonly client: WandbClient) {}

  async projectRuns(options: ProjectRunsOptions) {
    const { entity, project, first = 50, order, filters } = options;
    const variables: Record<string, unknown> = { entity, project, first };
    if (order) variables.order = order;
    if (filters) variables.filters = JSON.stringify(filters);

    return this.client.query<ProjectRunsResponse>(PROJECT_RUNS_QUERY, variables);
  }
}
