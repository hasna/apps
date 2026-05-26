// ClickUp Connector Types
// Workspaces, spaces, folders, lists, and tasks management

// ============================================
// Configuration
// ============================================

export interface ClickUpConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// User Types
// ============================================

export interface User {
  id: number;
  username: string;
  email: string;
  color: string;
  profilePicture?: string;
  initials: string;
  role?: number;
  custom_role?: string | null;
  last_active?: string;
  date_joined?: string;
  date_invited?: string;
}

export interface Member {
  user: User;
  invited_by?: User;
}

// ============================================
// Workspace (Team) Types
// ============================================

export interface Workspace {
  id: string;
  name: string;
  color: string;
  avatar?: string;
  members: Member[];
}

// ============================================
// Space Types
// ============================================

export interface Space {
  id: string;
  name: string;
  private: boolean;
  color?: string;
  avatar?: string;
  admin_can_manage?: boolean;
  statuses: Status[];
  multiple_assignees: boolean;
  features?: SpaceFeatures;
  archived: boolean;
}

export interface SpaceFeatures {
  due_dates?: {
    enabled: boolean;
    start_date: boolean;
    remap_due_dates: boolean;
    remap_closed_due_date: boolean;
  };
  time_tracking?: {
    enabled: boolean;
  };
  tags?: {
    enabled: boolean;
  };
  time_estimates?: {
    enabled: boolean;
  };
  checklists?: {
    enabled: boolean;
  };
  custom_fields?: {
    enabled: boolean;
  };
  remap_dependencies?: {
    enabled: boolean;
  };
  dependency_warning?: {
    enabled: boolean;
  };
  portfolios?: {
    enabled: boolean;
  };
}

export interface CreateSpaceInput {
  name: string;
  multiple_assignees?: boolean;
  features?: SpaceFeatures;
}

// ============================================
// Folder Types
// ============================================

export interface Folder {
  id: string;
  name: string;
  orderindex: number;
  override_statuses: boolean;
  hidden: boolean;
  space: {
    id: string;
    name: string;
    access?: boolean;
  };
  task_count?: string;
  archived: boolean;
  statuses?: Status[];
  lists?: List[];
  permission_level?: string;
}

export interface CreateFolderInput {
  name: string;
}

// ============================================
// List Types
// ============================================

export interface List {
  id: string;
  name: string;
  orderindex: number;
  content?: string;
  status?: {
    status: string;
    color: string;
    hide_label: boolean;
  };
  priority?: {
    priority: string;
    color: string;
  };
  assignee?: User;
  task_count?: number;
  due_date?: string;
  start_date?: string;
  folder: {
    id: string;
    name: string;
    hidden: boolean;
    access?: boolean;
  };
  space: {
    id: string;
    name: string;
    access?: boolean;
  };
  archived: boolean;
  override_statuses: boolean;
  statuses?: Status[];
  permission_level?: string;
}

export interface CreateListInput {
  name: string;
  content?: string;
  due_date?: number;
  due_date_time?: boolean;
  priority?: number;
  assignee?: number;
  status?: string;
}

// ============================================
// Task Types
// ============================================

export interface Task {
  id: string;
  custom_id?: string;
  name: string;
  text_content?: string;
  description?: string;
  status: Status;
  orderindex: string;
  date_created: string;
  date_updated: string;
  date_closed?: string;
  date_done?: string;
  archived: boolean;
  creator: User;
  assignees: User[];
  watchers?: User[];
  checklists?: Checklist[];
  tags: Tag[];
  parent?: string;
  priority?: Priority;
  due_date?: string;
  start_date?: string;
  points?: number;
  time_estimate?: number;
  time_spent?: number;
  custom_fields?: CustomField[];
  dependencies?: Dependency[];
  linked_tasks?: LinkedTask[];
  team_id: string;
  url: string;
  permission_level?: string;
  list: {
    id: string;
    name: string;
    access?: boolean;
  };
  project?: {
    id: string;
    name: string;
    hidden: boolean;
    access?: boolean;
  };
  folder: {
    id: string;
    name: string;
    hidden: boolean;
    access?: boolean;
  };
  space: {
    id: string;
  };
  attachments?: Attachment[];
}

export interface CreateTaskInput {
  name: string;
  description?: string;
  assignees?: number[];
  tags?: string[];
  status?: string;
  priority?: number;
  due_date?: number;
  due_date_time?: boolean;
  time_estimate?: number;
  start_date?: number;
  start_date_time?: boolean;
  notify_all?: boolean;
  parent?: string;
  links_to?: string;
  check_required_custom_fields?: boolean;
  custom_fields?: Array<{
    id: string;
    value: unknown;
  }>;
}

export interface UpdateTaskInput {
  name?: string;
  description?: string;
  assignees?: {
    add?: number[];
    rem?: number[];
  };
  status?: string;
  priority?: number;
  due_date?: number;
  due_date_time?: boolean;
  time_estimate?: number;
  start_date?: number;
  start_date_time?: boolean;
  archived?: boolean;
  parent?: string;
}

export interface TasksResponse {
  tasks: Task[];
  last_page?: boolean;
}

// ============================================
// Status Types
// ============================================

export interface Status {
  id?: string;
  status: string;
  type: string;
  orderindex: number;
  color: string;
}

// ============================================
// Priority Types
// ============================================

export interface Priority {
  id?: string;
  priority: string;
  color: string;
  orderindex: string;
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  name: string;
  tag_fg: string;
  tag_bg: string;
  creator?: number;
}

// ============================================
// Checklist Types
// ============================================

export interface Checklist {
  id: string;
  task_id: string;
  name: string;
  date_created: string;
  orderindex: number;
  creator: number;
  resolved: number;
  unresolved: number;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  name: string;
  orderindex: number;
  assignee?: User;
  group_assignee?: unknown;
  resolved: boolean;
  parent?: string;
  date_created: string;
  children?: ChecklistItem[];
}

export interface CreateChecklistInput {
  name: string;
}

export interface CreateChecklistItemInput {
  name: string;
  assignee?: number;
}

// ============================================
// Custom Field Types
// ============================================

export interface CustomField {
  id: string;
  name: string;
  type: string;
  type_config?: Record<string, unknown>;
  date_created: string;
  hide_from_guests: boolean;
  value?: unknown;
  required?: boolean;
}

// ============================================
// Dependency Types
// ============================================

export interface Dependency {
  task_id: string;
  depends_on: string;
  type: number;
  date_created: string;
  userid: string;
  workspace_id?: string;
}

export interface LinkedTask {
  task_id: string;
  link_id: string;
  date_created: string;
  userid: string;
}

// ============================================
// Attachment Types
// ============================================

export interface Attachment {
  id: string;
  date: string;
  title: string;
  type: number;
  source: number;
  version: number;
  extension: string;
  thumbnail_small?: string;
  thumbnail_medium?: string;
  thumbnail_large?: string;
  is_folder?: boolean;
  mimetype?: string;
  hidden?: boolean;
  parent_id?: string;
  size?: number;
  total_comments?: number;
  resolved_comments?: number;
  user?: User;
  deleted?: boolean;
  orientation?: string;
  url?: string;
  parent_comment_type?: string;
  parent_comment_parent?: string;
  email_data?: unknown;
  url_w_query?: string;
  url_w_host?: string;
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: string;
  comment: CommentContent[];
  comment_text: string;
  user: User;
  resolved: boolean;
  assignee?: User;
  assigned_by?: User;
  reactions?: Reaction[];
  date: string;
}

export interface CommentContent {
  text?: string;
  attributes?: Record<string, unknown>;
}

export interface Reaction {
  reaction: string;
  date: string;
  user: User;
}

export interface CreateCommentInput {
  comment_text: string;
  assignee?: number;
  notify_all?: boolean;
}

// ============================================
// Time Entry Types
// ============================================

export interface TimeEntry {
  id: string;
  task: {
    id: string;
    name: string;
    status: Status;
    custom_type?: unknown;
  };
  wid: string;
  user: User;
  billable: boolean;
  start: string;
  end?: string;
  duration: string;
  description?: string;
  tags?: Tag[];
  source?: string;
  at?: string;
  task_location?: {
    list_id: string;
    folder_id: string;
    space_id: string;
    list_name?: string;
    folder_name?: string;
    space_name?: string;
  };
  task_url?: string;
}

// ============================================
// Goal Types
// ============================================

export interface Goal {
  id: string;
  pretty_id: string;
  name: string;
  team_id: string;
  date_created: string;
  start_date?: string;
  due_date?: string;
  description?: string;
  private: boolean;
  archived: boolean;
  creator: number;
  color: string;
  pretty_url: string;
  multiple_owners: boolean;
  folder_id?: string;
  members: Member[];
  owners: User[];
  key_results?: KeyResult[];
  percent_completed: number;
  history?: unknown[];
  reactions?: Reaction[];
}

export interface KeyResult {
  id: string;
  goal_id: string;
  name: string;
  creator: number;
  type: string;
  date_created: string;
  goal_pretty_id: string;
  percent_completed: number;
  completed: boolean;
  task_ids?: string[];
  subcategory_ids?: string[];
  owners: User[];
  steps_start?: number;
  steps_end?: number;
  steps_current?: number;
  unit?: string;
  last_action?: unknown;
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: string;
  userid: number;
  team_id: number;
  endpoint: string;
  client_id?: string;
  events: string[];
  task_id?: string;
  list_id?: string;
  folder_id?: string;
  space_id?: string;
  health: {
    status: string;
    fail_count: number;
  };
  secret?: string;
}

export interface CreateWebhookInput {
  endpoint: string;
  events: string[];
  task_id?: string;
  list_id?: string;
  folder_id?: string;
  space_id?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ClickUpError {
  err: string;
  ECODE: string;
}

export class ClickUpApiError extends Error {
  public readonly statusCode: number;
  public readonly ecode?: string;

  constructor(message: string, statusCode: number, ecode?: string) {
    super(message);
    this.name = 'ClickUpApiError';
    this.statusCode = statusCode;
    this.ecode = ecode;
  }
}
