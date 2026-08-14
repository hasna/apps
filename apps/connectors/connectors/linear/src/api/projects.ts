import type { LinearClient } from './client';
import type { LinearProject, ProjectsResponse, ProjectResponse, ListOptions } from '../types';

const PROJECT_FRAGMENT = `
  fragment ProjectFragment on Project {
    id
    name
    description
    icon
    color
    state
    progress
    startDate
    targetDate
    createdAt
    updatedAt
    lead {
      id
      name
      displayName
      email
    }
    teams {
      nodes {
        id
        name
        key
      }
    }
  }
`;

export interface CreateProjectInput {
  name: string;
  description?: string;
  teamIds: string[];
  leadId?: string;
  startDate?: string;
  targetDate?: string;
  color?: string;
  icon?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  leadId?: string;
  startDate?: string;
  targetDate?: string;
  color?: string;
  icon?: string;
  state?: string;
}

interface ProjectPayload {
  success: boolean;
  project?: LinearProject;
}

interface CreateProjectResponse {
  projectCreate: ProjectPayload;
}

interface UpdateProjectResponse {
  projectUpdate: ProjectPayload;
}

export class ProjectsApi {
  constructor(private readonly client: LinearClient) {}

  /**
   * List all projects
   */
  async list(options: ListOptions = {}): Promise<LinearProject[]> {
    const { first = 50, after } = options;

    const query = `
      ${PROJECT_FRAGMENT}
      query Projects($first: Int, $after: String) {
        projects(first: $first, after: $after) {
          nodes {
            ...ProjectFragment
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const result = await this.client.query<ProjectsResponse>(query, {
      first,
      after,
    });

    return result.projects.nodes;
  }

  /**
   * Get a single project by ID
   */
  async get(id: string): Promise<LinearProject> {
    const query = `
      ${PROJECT_FRAGMENT}
      query Project($id: String!) {
        project(id: $id) {
          ...ProjectFragment
        }
      }
    `;

    const result = await this.client.query<ProjectResponse>(query, { id });
    return result.project;
  }

  /**
   * Create a new project
   */
  async create(input: CreateProjectInput): Promise<LinearProject> {
    const mutation = `
      ${PROJECT_FRAGMENT}
      mutation CreateProject($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          success
          project {
            ...ProjectFragment
          }
        }
      }
    `;

    const result = await this.client.mutate<CreateProjectResponse>(mutation, {
      input,
    });

    if (!result.projectCreate.success || !result.projectCreate.project) {
      throw new Error('Failed to create project');
    }

    return result.projectCreate.project;
  }

  /**
   * Update a project
   */
  async update(id: string, input: UpdateProjectInput): Promise<LinearProject> {
    const mutation = `
      ${PROJECT_FRAGMENT}
      mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) {
          success
          project {
            ...ProjectFragment
          }
        }
      }
    `;

    const result = await this.client.mutate<UpdateProjectResponse>(mutation, {
      id,
      input,
    });

    if (!result.projectUpdate.success || !result.projectUpdate.project) {
      throw new Error('Failed to update project');
    }

    return result.projectUpdate.project;
  }

  /**
   * Search projects by name
   */
  async findByName(name: string): Promise<LinearProject | undefined> {
    const projects = await this.list();
    return projects.find(p => p.name.toLowerCase() === name.toLowerCase());
  }
}
