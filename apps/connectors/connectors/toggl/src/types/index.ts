// Toggl Track Connector Types

export interface TogglConfig {
  apiToken: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TogglError {
  message?: string;
  error?: string;
  description?: string;
}

export class TogglApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TogglApiError';
    this.statusCode = statusCode;
  }
}

export interface User {
  id: number;
  email: string;
  fullname: string;
  timezone: string;
  default_workspace_id?: number;
  beginning_of_week?: number;
  image_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Workspace {
  id: number;
  name: string;
  profile?: number;
  premium?: boolean;
  admin?: boolean;
  default_currency?: string;
  only_admins_may_create_projects?: boolean;
  only_admins_see_billable_rates?: boolean;
  only_admins_see_team_dashboard?: boolean;
  projects_billable_by_default?: boolean;
  rate_last_updated?: string;
  rate?: number;
  organization_id?: number;
  ical_enabled?: boolean;
  at?: string;
}

export interface Project {
  id: number;
  workspace_id: number;
  client_id?: number | null;
  name: string;
  active: boolean;
  is_private?: boolean;
  billable?: boolean;
  color?: string;
  rate?: number | null;
  currency?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  at?: string;
}

export interface Client {
  id: number;
  workspace_id: number;
  name: string;
  archived?: boolean;
  notes?: string | null;
  at?: string;
}

export interface Tag {
  id: number;
  workspace_id: number;
  name: string;
  at?: string;
}

export interface Task {
  id: number;
  project_id: number;
  name: string;
  active: boolean;
  estimated_seconds?: number | null;
  user_id?: number;
  at?: string;
}

export interface TimeEntry {
  id: number;
  workspace_id: number;
  project_id?: number | null;
  task_id?: number | null;
  user_id?: number;
  description?: string;
  billable?: boolean;
  start: string;
  stop?: string | null;
  duration: number;
  tags?: string[];
  tag_ids?: number[];
  created_with?: string;
  at?: string;
}

export interface Organization {
  id: number;
  name: string;
  pricing_plan_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceUser {
  id: number;
  uid: number;
  wid: number;
  admin: boolean;
  email: string;
  inactive: boolean;
  at?: string;
}

export interface Group {
  id: number;
  group_id: number;
  name: string;
  wid: number;
  at?: string;
}

export interface CreateProjectInput {
  name: string;
  client_id?: number;
  color?: string;
  is_private?: boolean;
  active?: boolean;
  estimated_hours?: number;
  auto_estimates?: boolean;
  rate?: number;
  rate_change_mode?: 'start-today' | 'override-current' | 'override-all';
  currency?: string;
  billable?: boolean;
  template?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface UpdateProjectInput {
  name?: string;
  client_id?: number;
  color?: string;
  is_private?: boolean;
  active?: boolean;
  estimated_hours?: number;
  rate?: number;
  billable?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface CreateClientInput {
  name: string;
  notes?: string;
}

export interface UpdateClientInput {
  name?: string;
  notes?: string;
  archived?: boolean;
}

export interface CreateTaskInput {
  name: string;
  estimated_seconds?: number;
  user_id?: number;
  active?: boolean;
}

export interface CreateTimeEntryInput {
  description?: string;
  project_id?: number;
  task_id?: number;
  tags?: string[];
  tag_ids?: number[];
  billable?: boolean;
  start: string;
  stop?: string;
  duration?: number;
  created_with: string;
  user_id?: number;
  workspace_id?: number;
}

export interface UpdateTimeEntryInput {
  description?: string;
  project_id?: number;
  task_id?: number;
  tags?: string[];
  tag_ids?: number[];
  billable?: boolean;
  start?: string;
  stop?: string;
  duration?: number;
}

export interface ListProjectsOptions {
  active?: boolean | 'true' | 'false' | 'both';
  sinceDate?: string;
  billable?: boolean;
  userIds?: number[];
  clientIds?: number[];
  groupIds?: number[];
  statuses?: string[];
  name?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  perPage?: number;
  page?: number;
}

export interface ListClientsOptions {
  status?: 'active' | 'archived' | 'both';
  name?: string;
}

export interface ListTasksOptions {
  projectId?: number;
  perPage?: number;
  page?: number;
  active?: boolean;
}

export interface ListTimeEntriesOptions {
  startDate?: string;
  endDate?: string;
  before?: string;
  since?: number;
  meta?: boolean;
}
