// Asana Connector Types
// Projects, tasks, workspaces, and teams management

// ============================================
// Configuration
// ============================================

export interface AsanaConfig {
  accessToken: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface AsanaResponse<T> {
  data: T;
}

export interface AsanaListResponse<T> {
  data: T[];
  next_page?: {
    offset: string;
    path: string;
    uri: string;
  };
}

// ============================================
// Workspace Types
// ============================================

export interface Workspace {
  gid: string;
  name: string;
  resource_type: 'workspace';
  is_organization?: boolean;
  email_domains?: string[];
}

// ============================================
// User Types
// ============================================

export interface User {
  gid: string;
  name: string;
  resource_type: 'user';
  email?: string;
  photo?: {
    image_21x21?: string;
    image_27x27?: string;
    image_36x36?: string;
    image_60x60?: string;
    image_128x128?: string;
  };
  workspaces?: Workspace[];
}

// ============================================
// Team Types
// ============================================

export interface Team {
  gid: string;
  name: string;
  resource_type: 'team';
  description?: string;
  html_description?: string;
  organization?: Workspace;
  visibility?: 'secret' | 'request_to_join' | 'public';
}

// ============================================
// Project Types
// ============================================

export interface Project {
  gid: string;
  name: string;
  resource_type: 'project';
  archived?: boolean;
  color?: string;
  created_at?: string;
  current_status?: ProjectStatus;
  current_status_update?: StatusUpdate;
  due_date?: string;
  due_on?: string;
  html_notes?: string;
  notes?: string;
  owner?: User;
  public?: boolean;
  start_on?: string;
  team?: Team;
  workspace?: Workspace;
  completed?: boolean;
  completed_at?: string;
}

export interface ProjectStatus {
  gid: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
  text: string;
  author?: User;
  created_at?: string;
}

export interface StatusUpdate {
  gid: string;
  resource_type: 'status_update';
  title?: string;
  text?: string;
  status_type?: string;
  created_at?: string;
}

export interface CreateProjectInput {
  name: string;
  workspace?: string;
  team?: string;
  notes?: string;
  color?: string;
  due_on?: string;
  start_on?: string;
  public?: boolean;
  archived?: boolean;
}

// ============================================
// Section Types
// ============================================

export interface Section {
  gid: string;
  name: string;
  resource_type: 'section';
  created_at?: string;
  project?: Project;
}

export interface CreateSectionInput {
  name: string;
  insert_before?: string;
  insert_after?: string;
}

// ============================================
// Task Types
// ============================================

export interface Task {
  gid: string;
  name: string;
  resource_type: 'task';
  approval_status?: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  assignee?: User;
  assignee_status?: 'inbox' | 'today' | 'upcoming' | 'later';
  completed?: boolean;
  completed_at?: string;
  created_at?: string;
  due_at?: string;
  due_on?: string;
  html_notes?: string;
  notes?: string;
  num_subtasks?: number;
  parent?: Task;
  projects?: Project[];
  start_at?: string;
  start_on?: string;
  tags?: Tag[];
  workspace?: Workspace;
  memberships?: { project: Project; section: Section }[];
  followers?: User[];
}

export interface CreateTaskInput {
  name: string;
  workspace?: string;
  projects?: string[];
  assignee?: string;
  notes?: string;
  html_notes?: string;
  due_on?: string;
  due_at?: string;
  start_on?: string;
  start_at?: string;
  completed?: boolean;
  parent?: string;
  tags?: string[];
  followers?: string[];
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  gid: string;
  name: string;
  resource_type: 'tag';
  color?: string;
  workspace?: Workspace;
}

export interface CreateTagInput {
  name: string;
  workspace: string;
  color?: string;
}

// ============================================
// Story Types (Comments)
// ============================================

export interface Story {
  gid: string;
  resource_type: 'story';
  created_at?: string;
  created_by?: User;
  text?: string;
  html_text?: string;
  type?: 'comment' | 'system';
  is_pinned?: boolean;
}

export interface CreateStoryInput {
  text: string;
  html_text?: string;
  is_pinned?: boolean;
}

// ============================================
// Attachment Types
// ============================================

export interface Attachment {
  gid: string;
  name: string;
  resource_type: 'attachment';
  created_at?: string;
  download_url?: string;
  host?: 'asana' | 'dropbox' | 'gdrive' | 'onedrive' | 'box' | 'vimeo' | 'external';
  parent?: Task;
  view_url?: string;
}

// ============================================
// API Error Types
// ============================================

export interface AsanaErrorDetail {
  message: string;
  help?: string;
  phrase?: string;
}

export class AsanaApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: AsanaErrorDetail[];

  constructor(message: string, statusCode: number, errors?: AsanaErrorDetail[]) {
    super(message);
    this.name = 'AsanaApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
