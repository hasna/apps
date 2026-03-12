// Linear API Types

export type OutputFormat = 'json' | 'table' | 'pretty';

// Configuration
export interface LinearConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface CliConfig {
  apiKey?: string;
  defaultTeamId?: string;
}

// API Error
export class LinearApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'LinearApiError';
  }
}

// GraphQL response wrapper
export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

// User types
export interface LinearUser {
  id: string;
  name: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  active: boolean;
  admin: boolean;
  createdAt: string;
  updatedAt: string;
}

// Team types
export interface LinearTeam {
  id: string;
  name: string;
  key: string;
  description?: string;
  icon?: string;
  color?: string;
  private: boolean;
  createdAt: string;
  updatedAt: string;
}

// Issue state types
export interface LinearWorkflowState {
  id: string;
  name: string;
  color: string;
  type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
  position: number;
}

// Issue label types
export interface LinearLabel {
  id: string;
  name: string;
  color: string;
  description?: string;
}

// Issue priority
export type LinearPriority = 0 | 1 | 2 | 3 | 4; // 0 = no priority, 1 = urgent, 2 = high, 3 = normal, 4 = low

// Issue types
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: LinearPriority;
  priorityLabel: string;
  estimate?: number;
  sortOrder: number;
  boardOrder: number;
  startedAt?: string;
  completedAt?: string;
  canceledAt?: string;
  autoClosedAt?: string;
  autoArchivedAt?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  url: string;
  number: number;
  team?: LinearTeam;
  state?: LinearWorkflowState;
  assignee?: LinearUser;
  creator?: LinearUser;
  labels?: { nodes: LinearLabel[] };
  project?: LinearProject;
  parent?: LinearIssue;
  children?: { nodes: LinearIssue[] };
  comments?: { nodes: LinearComment[] };
}

// Comment types
export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  user?: LinearUser;
  issue?: LinearIssue;
}

// Project types
export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  state: string;
  progress: number;
  startDate?: string;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
  lead?: LinearUser;
  teams?: { nodes: LinearTeam[] };
}

// Cycle types
export interface LinearCycle {
  id: string;
  number: number;
  name?: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  completedAt?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  team?: LinearTeam;
}

// Pagination
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

// API Response types
export interface IssuesResponse {
  issues: Connection<LinearIssue>;
}

export interface IssueResponse {
  issue: LinearIssue;
}

export interface TeamsResponse {
  teams: Connection<LinearTeam>;
}

export interface TeamResponse {
  team: LinearTeam;
}

export interface UsersResponse {
  users: Connection<LinearUser>;
}

export interface UserResponse {
  user: LinearUser;
}

export interface ViewerResponse {
  viewer: LinearUser;
}

export interface ProjectsResponse {
  projects: Connection<LinearProject>;
}

export interface ProjectResponse {
  project: LinearProject;
}

// Request options
export interface ListOptions {
  first?: number;
  after?: string;
  orderBy?: string;
}

export interface IssueListOptions extends ListOptions {
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
  stateId?: string;
  filter?: IssueFilter;
}

export interface IssueFilter {
  team?: { id?: { eq?: string } };
  project?: { id?: { eq?: string } };
  assignee?: { id?: { eq?: string } };
  state?: { name?: { eq?: string }; type?: { eq?: string } };
  priority?: { eq?: number };
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  teamId: string;
  projectId?: string;
  assigneeId?: string;
  priority?: LinearPriority;
  stateId?: string;
  labelIds?: string[];
  estimate?: number;
  dueDate?: string;
  parentId?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  projectId?: string;
  assigneeId?: string;
  priority?: LinearPriority;
  stateId?: string;
  labelIds?: string[];
  estimate?: number;
  dueDate?: string;
}

// Mutation response types
export interface IssuePayload {
  success: boolean;
  issue?: LinearIssue;
}

export interface CreateIssueResponse {
  issueCreate: IssuePayload;
}

export interface UpdateIssueResponse {
  issueUpdate: IssuePayload;
}

export interface ArchiveIssueResponse {
  issueArchive: IssuePayload;
}
