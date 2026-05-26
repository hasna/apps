// Todoist Connector Types
// Projects, tasks, sections, labels, and comments management

// ============================================
// Configuration
// ============================================

export interface TodoistConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Project Types
// ============================================

export interface Project {
  id: string;
  name: string;
  comment_count: number;
  order: number;
  color: string;
  is_shared: boolean;
  is_favorite: boolean;
  is_inbox_project: boolean;
  is_team_inbox: boolean;
  view_style: 'list' | 'board';
  url: string;
  parent_id?: string | null;
}

export interface CreateProjectInput {
  name: string;
  parent_id?: string;
  color?: string;
  is_favorite?: boolean;
  view_style?: 'list' | 'board';
}

export interface UpdateProjectInput {
  name?: string;
  color?: string;
  is_favorite?: boolean;
  view_style?: 'list' | 'board';
}

// ============================================
// Section Types
// ============================================

export interface Section {
  id: string;
  project_id: string;
  order: number;
  name: string;
}

export interface CreateSectionInput {
  name: string;
  project_id: string;
  order?: number;
}

export interface UpdateSectionInput {
  name: string;
}

// ============================================
// Task Types
// ============================================

export interface Task {
  id: string;
  project_id: string;
  section_id?: string | null;
  content: string;
  description: string;
  is_completed: boolean;
  labels: string[];
  parent_id?: string | null;
  order: number;
  priority: number;
  due?: Due | null;
  url: string;
  comment_count: number;
  created_at: string;
  creator_id: string;
  assignee_id?: string | null;
  assigner_id?: string | null;
  duration?: Duration | null;
}

export interface Due {
  date: string;
  string: string;
  lang: string;
  is_recurring: boolean;
  datetime?: string;
  timezone?: string;
}

export interface Duration {
  amount: number;
  unit: 'minute' | 'day';
}

export interface CreateTaskInput {
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  parent_id?: string;
  order?: number;
  labels?: string[];
  priority?: number;
  due_string?: string;
  due_date?: string;
  due_datetime?: string;
  due_lang?: string;
  assignee_id?: string;
  duration?: number;
  duration_unit?: 'minute' | 'day';
}

export interface UpdateTaskInput {
  content?: string;
  description?: string;
  labels?: string[];
  priority?: number;
  due_string?: string;
  due_date?: string;
  due_datetime?: string;
  due_lang?: string;
  assignee_id?: string | null;
  duration?: number;
  duration_unit?: 'minute' | 'day';
}

// ============================================
// Label Types
// ============================================

export interface Label {
  id: string;
  name: string;
  color: string;
  order: number;
  is_favorite: boolean;
}

export interface CreateLabelInput {
  name: string;
  color?: string;
  order?: number;
  is_favorite?: boolean;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
  order?: number;
  is_favorite?: boolean;
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: string;
  task_id?: string;
  project_id?: string;
  posted_at: string;
  content: string;
  attachment?: Attachment;
}

export interface Attachment {
  file_name: string;
  file_type: string;
  file_url: string;
  resource_type: string;
}

export interface CreateCommentInput {
  content: string;
  task_id?: string;
  project_id?: string;
  attachment?: {
    file_url: string;
    file_type?: string;
    resource_type?: string;
  };
}

export interface UpdateCommentInput {
  content: string;
}

// ============================================
// Collaborator Types
// ============================================

export interface Collaborator {
  id: string;
  name: string;
  email: string;
}

// ============================================
// API Error Types
// ============================================

export interface TodoistError {
  error: string;
  error_code?: number;
  error_extra?: Record<string, unknown>;
  error_tag?: string;
  http_code?: number;
}

export class TodoistApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: number;
  public readonly errorTag?: string;

  constructor(message: string, statusCode: number, errorCode?: number, errorTag?: string) {
    super(message);
    this.name = 'TodoistApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.errorTag = errorTag;
  }
}
