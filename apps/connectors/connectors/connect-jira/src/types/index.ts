// Jira Connector Types
// Projects, issues, boards, and sprints management

// ============================================
// Configuration
// ============================================

export interface JiraConfig {
  email: string;
  apiToken: string;
  domain: string; // e.g., "mycompany.atlassian.net"
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  startAt: number;
  maxResults: number;
  total: number;
  values: T[];
  isLast?: boolean;
}

export interface SearchResponse<T> {
  startAt: number;
  maxResults: number;
  total: number;
  issues: T[];
}

// ============================================
// User Types
// ============================================

export interface User {
  accountId: string;
  accountType?: string;
  emailAddress?: string;
  displayName: string;
  active: boolean;
  timeZone?: string;
  locale?: string;
  avatarUrls?: AvatarUrls;
  self?: string;
}

export interface AvatarUrls {
  '16x16'?: string;
  '24x24'?: string;
  '32x32'?: string;
  '48x48'?: string;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: User;
  projectTypeKey?: string;
  simplified?: boolean;
  style?: string;
  isPrivate?: boolean;
  avatarUrls?: AvatarUrls;
  self?: string;
  components?: Component[];
  issueTypes?: IssueType[];
  versions?: Version[];
}

export interface Component {
  id: string;
  name: string;
  description?: string;
  lead?: User;
  assigneeType?: string;
  project?: string;
  projectId?: number;
  self?: string;
}

export interface Version {
  id: string;
  name: string;
  description?: string;
  archived?: boolean;
  released?: boolean;
  releaseDate?: string;
  startDate?: string;
  projectId?: number;
  self?: string;
}

// ============================================
// Issue Types
// ============================================

export interface Issue {
  id: string;
  key: string;
  self?: string;
  expand?: string;
  fields: IssueFields;
  changelog?: Changelog;
  renderedFields?: Record<string, unknown>;
  transitions?: Transition[];
}

export interface IssueFields {
  summary: string;
  description?: string | AdfDocument;
  issuetype: IssueType;
  project: Project;
  status: Status;
  priority?: Priority;
  assignee?: User;
  reporter?: User;
  creator?: User;
  created?: string;
  updated?: string;
  resolutiondate?: string;
  duedate?: string;
  labels?: string[];
  components?: Component[];
  fixVersions?: Version[];
  versions?: Version[];
  resolution?: Resolution;
  parent?: Issue;
  subtasks?: Issue[];
  issuelinks?: IssueLink[];
  attachment?: Attachment[];
  comment?: CommentPage;
  worklog?: WorklogPage;
  timetracking?: TimeTracking;
  customfield_10000?: unknown; // Sprint field (varies)
  [key: string]: unknown;
}

export interface IssueType {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask?: boolean;
  avatarId?: number;
  hierarchyLevel?: number;
  self?: string;
}

export interface Status {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  statusCategory?: StatusCategory;
  self?: string;
}

export interface StatusCategory {
  id: number;
  key: string;
  name: string;
  colorName?: string;
  self?: string;
}

export interface Priority {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  statusColor?: string;
  self?: string;
}

export interface Resolution {
  id: string;
  name: string;
  description?: string;
  self?: string;
}

export interface Transition {
  id: string;
  name: string;
  to: Status;
  hasScreen?: boolean;
  isGlobal?: boolean;
  isInitial?: boolean;
  isAvailable?: boolean;
  isConditional?: boolean;
  isLooped?: boolean;
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: string;
  author: User;
  body: string | AdfDocument;
  created: string;
  updated?: string;
  updateAuthor?: User;
  visibility?: Visibility;
  self?: string;
}

export interface CommentPage {
  startAt: number;
  maxResults: number;
  total: number;
  comments: Comment[];
}

export interface Visibility {
  type: 'group' | 'role';
  value: string;
}

// ============================================
// Worklog Types
// ============================================

export interface Worklog {
  id: string;
  author: User;
  updateAuthor?: User;
  comment?: string | AdfDocument;
  created: string;
  updated?: string;
  started: string;
  timeSpent: string;
  timeSpentSeconds: number;
  issueId?: string;
  self?: string;
}

export interface WorklogPage {
  startAt: number;
  maxResults: number;
  total: number;
  worklogs: Worklog[];
}

export interface TimeTracking {
  originalEstimate?: string;
  remainingEstimate?: string;
  timeSpent?: string;
  originalEstimateSeconds?: number;
  remainingEstimateSeconds?: number;
  timeSpentSeconds?: number;
}

// ============================================
// Attachment Types
// ============================================

export interface Attachment {
  id: string;
  filename: string;
  author: User;
  created: string;
  size: number;
  mimeType: string;
  content?: string;
  thumbnail?: string;
  self?: string;
}

// ============================================
// Issue Link Types
// ============================================

export interface IssueLink {
  id: string;
  type: IssueLinkType;
  inwardIssue?: Issue;
  outwardIssue?: Issue;
  self?: string;
}

export interface IssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
  self?: string;
}

// ============================================
// Changelog Types
// ============================================

export interface Changelog {
  startAt: number;
  maxResults: number;
  total: number;
  histories: ChangeHistory[];
}

export interface ChangeHistory {
  id: string;
  author: User;
  created: string;
  items: ChangeItem[];
}

export interface ChangeItem {
  field: string;
  fieldtype: string;
  fieldId?: string;
  from?: string;
  fromString?: string;
  to?: string;
  toString?: string;
}

// ============================================
// Board Types (Agile)
// ============================================

export interface Board {
  id: number;
  name: string;
  type: 'scrum' | 'kanban' | 'simple';
  self?: string;
  location?: BoardLocation;
}

export interface BoardLocation {
  projectId?: number;
  projectKey?: string;
  projectName?: string;
  projectTypeKey?: string;
  displayName?: string;
  avatarURI?: string;
}

// ============================================
// Sprint Types
// ============================================

export interface Sprint {
  id: number;
  name: string;
  state: 'future' | 'active' | 'closed';
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
  goal?: string;
  self?: string;
}

// ============================================
// ADF (Atlassian Document Format)
// ============================================

export interface AdfDocument {
  version: number;
  type: 'doc';
  content: AdfNode[];
}

export interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
}

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ============================================
// Input Types
// ============================================

export interface CreateIssueInput {
  fields: {
    project: { key: string } | { id: string };
    summary: string;
    issuetype: { name: string } | { id: string };
    description?: string | AdfDocument;
    assignee?: { accountId: string };
    reporter?: { accountId: string };
    priority?: { name: string } | { id: string };
    labels?: string[];
    components?: Array<{ name: string } | { id: string }>;
    fixVersions?: Array<{ name: string } | { id: string }>;
    duedate?: string;
    parent?: { key: string };
    [key: string]: unknown;
  };
}

export interface UpdateIssueInput {
  fields?: Partial<CreateIssueInput['fields']>;
  update?: Record<string, Array<{ add?: unknown; remove?: unknown; set?: unknown }>>;
}

export interface TransitionIssueInput {
  transition: { id: string };
  fields?: Record<string, unknown>;
  update?: Record<string, Array<{ add?: unknown; remove?: unknown; set?: unknown }>>;
}

export interface CreateCommentInput {
  body: string | AdfDocument;
  visibility?: Visibility;
}

// ============================================
// API Error Types
// ============================================

export interface JiraError {
  errorMessages?: string[];
  errors?: Record<string, string>;
}

export class JiraApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: Record<string, string>;
  public readonly errorMessages?: string[];

  constructor(message: string, statusCode: number, errorData?: JiraError) {
    super(message);
    this.name = 'JiraApiError';
    this.statusCode = statusCode;
    this.errors = errorData?.errors;
    this.errorMessages = errorData?.errorMessages;
  }
}
