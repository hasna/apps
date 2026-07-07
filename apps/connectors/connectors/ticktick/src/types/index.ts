// TickTick Connector Types

export interface TickTickConfig {
  accessToken: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type ViewMode = 'list' | 'kanban' | 'timeline';
export type ProjectKind = 'TASK' | 'NOTE';
export type TaskPriority = 0 | 1 | 3 | 5;
export type ChecklistItemStatus = 0 | 1;
export type TaskStatus = 0 | 2;

export interface Project {
  id: string;
  name: string;
  color?: string;
  closed?: boolean;
  groupId?: string;
  viewMode?: ViewMode;
  permission?: string;
  kind?: ProjectKind;
  sortOrder?: number;
}

export interface ProjectWithData extends Project {
  tasks?: Task[];
  columns?: unknown[];
}

export interface ChecklistItem {
  id?: string;
  title: string;
  status?: ChecklistItemStatus;
  sortOrder?: number;
  isAllDay?: boolean;
  startDate?: string;
  timeZone?: string;
  completedTime?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  reminders?: string[];
  repeatFlag?: string;
  priority?: TaskPriority;
  status?: TaskStatus | boolean;
  completedTime?: string;
  sortOrder?: number;
  items?: ChecklistItem[];
  kind?: string;
  tags?: string[];
}

export interface CreateProjectInput {
  name: string;
  color?: string;
  sortOrder?: number;
  viewMode?: ViewMode;
  kind?: ProjectKind;
  groupId?: string;
}

export interface UpdateProjectInput {
  name?: string;
  color?: string;
  sortOrder?: number;
  viewMode?: ViewMode;
  kind?: ProjectKind;
  groupId?: string;
}

export interface CreateTaskInput {
  title: string;
  projectId?: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  reminders?: string[];
  repeatFlag?: string;
  priority?: TaskPriority;
  sortOrder?: number;
  items?: ChecklistItem[];
  tags?: string[];
}

export interface UpdateTaskInput {
  id?: string;
  projectId?: string;
  title?: string;
  content?: string;
  desc?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  sortOrder?: number;
  items?: ChecklistItem[];
  tags?: string[];
}

export interface TickTickError {
  errorMessage?: string;
  error_description?: string;
  message?: string;
  error?: string;
}

export class TickTickApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TickTickApiError';
    this.statusCode = statusCode;
  }
}
