// GitLab Connector Types

// ============================================
// Configuration
// ============================================

export interface GitLabConfig {
  accessToken: string;
  baseUrl?: string; // Override default (gitlab.com)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  perPage: number;
  total?: number;
  totalPages?: number;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: number;
  username: string;
  name: string;
  state: 'active' | 'blocked' | 'deactivated';
  locked?: boolean;
  avatar_url?: string;
  web_url: string;
  created_at?: string;
  bio?: string;
  location?: string;
  public_email?: string;
  skype?: string;
  linkedin?: string;
  twitter?: string;
  website_url?: string;
  organization?: string;
  job_title?: string;
  pronouns?: string;
  bot?: boolean;
  work_information?: string;
  followers?: number;
  following?: number;
  is_followed?: boolean;
  local_time?: string;
  last_sign_in_at?: string;
  confirmed_at?: string;
  last_activity_on?: string;
  email?: string;
  theme_id?: number;
  color_scheme_id?: number;
  projects_limit?: number;
  current_sign_in_at?: string;
  note?: string;
  identities?: Array<{
    provider: string;
    extern_uid: string;
  }>;
  can_create_group?: boolean;
  can_create_project?: boolean;
  two_factor_enabled?: boolean;
  external?: boolean;
  private_profile?: boolean;
  commit_email?: string;
  shared_runners_minutes_limit?: number;
  extra_shared_runners_minutes_limit?: number;
  is_admin?: boolean;
  namespace_id?: number;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: number;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  description?: string;
  default_branch?: string;
  visibility: 'private' | 'internal' | 'public';
  ssh_url_to_repo: string;
  http_url_to_repo: string;
  web_url: string;
  readme_url?: string;
  topics?: string[];
  tag_list?: string[];
  owner?: User;
  namespace?: {
    id: number;
    name: string;
    path: string;
    kind: string;
    full_path: string;
  };
  star_count: number;
  forks_count: number;
  created_at: string;
  last_activity_at: string;
  archived?: boolean;
  avatar_url?: string;
  container_registry_enabled?: boolean;
  issues_enabled?: boolean;
  merge_requests_enabled?: boolean;
  wiki_enabled?: boolean;
  jobs_enabled?: boolean;
  snippets_enabled?: boolean;
  open_issues_count?: number;
  ci_config_path?: string;
  empty_repo?: boolean;
  permissions?: {
    project_access?: {
      access_level: number;
      notification_level: number;
    };
    group_access?: {
      access_level: number;
      notification_level: number;
    };
  };
}

export interface ProjectCreateParams {
  name: string;
  path?: string;
  namespace_id?: number;
  default_branch?: string;
  description?: string;
  issues_access_level?: 'disabled' | 'private' | 'enabled';
  repository_access_level?: 'disabled' | 'private' | 'enabled';
  merge_requests_access_level?: 'disabled' | 'private' | 'enabled';
  forking_access_level?: 'disabled' | 'private' | 'enabled';
  builds_access_level?: 'disabled' | 'private' | 'enabled';
  wiki_access_level?: 'disabled' | 'private' | 'enabled';
  snippets_access_level?: 'disabled' | 'private' | 'enabled';
  pages_access_level?: 'disabled' | 'private' | 'enabled' | 'public';
  visibility?: 'private' | 'internal' | 'public';
  import_url?: string;
  initialize_with_readme?: boolean;
  auto_devops_enabled?: boolean;
  container_registry_enabled?: boolean;
  shared_runners_enabled?: boolean;
  only_allow_merge_if_pipeline_succeeds?: boolean;
  only_allow_merge_if_all_discussions_are_resolved?: boolean;
  topics?: string[];
  avatar?: string;
}

// ============================================
// Issue Types
// ============================================

export interface Issue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description?: string;
  state: 'opened' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at?: string;
  closed_by?: User;
  labels: string[];
  milestone?: Milestone;
  assignees?: User[];
  author: User;
  type?: 'issue' | 'incident' | 'test_case' | 'task';
  assignee?: User;
  user_notes_count?: number;
  merge_requests_count?: number;
  upvotes: number;
  downvotes: number;
  due_date?: string;
  confidential: boolean;
  discussion_locked?: boolean;
  issue_type?: string;
  web_url: string;
  time_stats?: {
    time_estimate: number;
    total_time_spent: number;
    human_time_estimate?: string;
    human_total_time_spent?: string;
  };
  task_completion_status?: {
    count: number;
    completed_count: number;
  };
  weight?: number;
  blocking_issues_count?: number;
  has_tasks?: boolean;
  _links?: {
    self: string;
    notes: string;
    award_emoji: string;
    project: string;
    closed_as_duplicate_of?: string;
  };
  references?: {
    short: string;
    relative: string;
    full: string;
  };
  severity?: string;
  moved_to_id?: number;
  service_desk_reply_to?: string;
}

export interface IssueCreateParams {
  title: string;
  description?: string;
  confidential?: boolean;
  assignee_ids?: number[];
  milestone_id?: number;
  labels?: string;
  created_at?: string;
  due_date?: string;
  merge_request_to_resolve_discussions_of?: number;
  discussion_to_resolve?: string;
  weight?: number;
  issue_type?: 'issue' | 'incident' | 'test_case' | 'task';
}

// ============================================
// Merge Request Types
// ============================================

export interface MergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description?: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  created_at: string;
  updated_at: string;
  merged_by?: User;
  merge_user?: User;
  merged_at?: string;
  closed_by?: User;
  closed_at?: string;
  target_branch: string;
  source_branch: string;
  user_notes_count?: number;
  upvotes: number;
  downvotes: number;
  author: User;
  assignees?: User[];
  assignee?: User;
  reviewers?: User[];
  source_project_id: number;
  target_project_id: number;
  labels: string[];
  draft?: boolean;
  work_in_progress: boolean;
  milestone?: Milestone;
  merge_when_pipeline_succeeds: boolean;
  merge_status: string;
  detailed_merge_status?: string;
  sha: string;
  merge_commit_sha?: string;
  squash_commit_sha?: string;
  discussion_locked?: boolean;
  should_remove_source_branch?: boolean;
  force_remove_source_branch?: boolean;
  reference?: string;
  references?: {
    short: string;
    relative: string;
    full: string;
  };
  web_url: string;
  time_stats?: {
    time_estimate: number;
    total_time_spent: number;
    human_time_estimate?: string;
    human_total_time_spent?: string;
  };
  squash?: boolean;
  task_completion_status?: {
    count: number;
    completed_count: number;
  };
  has_conflicts?: boolean;
  blocking_discussions_resolved?: boolean;
  approvals_before_merge?: number;
  diverged_commits_count?: number;
  rebase_in_progress?: boolean;
  first_contribution?: boolean;
  pipeline?: Pipeline;
  diff_refs?: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
  changes_count?: string;
  latest_build_started_at?: string;
  latest_build_finished_at?: string;
  first_deployed_to_production_at?: string;
  head_pipeline?: Pipeline;
}

export interface MergeRequestCreateParams {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
  assignee_id?: number;
  assignee_ids?: number[];
  reviewer_ids?: number[];
  labels?: string;
  milestone_id?: number;
  target_project_id?: number;
  remove_source_branch?: boolean;
  allow_collaboration?: boolean;
  allow_maintainer_to_push?: boolean;
  squash?: boolean;
}

// ============================================
// Pipeline Types
// ============================================

export interface Pipeline {
  id: number;
  iid?: number;
  project_id?: number;
  sha: string;
  ref: string;
  status: 'created' | 'waiting_for_resource' | 'preparing' | 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 'manual' | 'scheduled';
  source?: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  before_sha?: string;
  tag?: boolean;
  yaml_errors?: string;
  user?: User;
  started_at?: string;
  finished_at?: string;
  committed_at?: string;
  duration?: number;
  queued_duration?: number;
  coverage?: string;
  detailed_status?: {
    icon: string;
    text: string;
    label: string;
    group: string;
    tooltip: string;
    has_details: boolean;
    details_path: string;
    illustration?: {
      image: string;
      size: string;
      title: string;
      content: string;
    };
    favicon: string;
  };
}

// ============================================
// Job Types
// ============================================

export interface Job {
  id: number;
  status: 'created' | 'pending' | 'running' | 'failed' | 'success' | 'canceled' | 'skipped' | 'manual';
  stage: string;
  name: string;
  ref: string;
  tag: boolean;
  coverage?: number;
  allow_failure: boolean;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  erased_at?: string;
  duration?: number;
  queued_duration?: number;
  user: User;
  commit: {
    id: string;
    short_id: string;
    title: string;
    message: string;
    author_name: string;
    author_email: string;
    created_at: string;
  };
  pipeline: Pipeline;
  web_url: string;
  project?: {
    ci_job_token_scope_enabled: boolean;
  };
  artifacts?: Array<{
    file_type: string;
    size: number;
    filename: string;
    file_format?: string;
  }>;
  runner?: {
    id: number;
    description: string;
    ip_address?: string;
    active: boolean;
    paused: boolean;
    is_shared: boolean;
    runner_type: string;
    name?: string;
    online: boolean;
    status: string;
  };
  artifacts_expire_at?: string;
  tag_list?: string[];
}

// ============================================
// Branch Types
// ============================================

export interface Branch {
  name: string;
  merged: boolean;
  protected: boolean;
  default: boolean;
  developers_can_push: boolean;
  developers_can_merge: boolean;
  can_push: boolean;
  web_url: string;
  commit: {
    id: string;
    short_id: string;
    title: string;
    message: string;
    author_name: string;
    author_email: string;
    authored_date: string;
    committer_name: string;
    committer_email: string;
    committed_date: string;
    created_at: string;
    parent_ids?: string[];
    trailers?: Record<string, string>;
    web_url: string;
  };
}

// ============================================
// Commit Types
// ============================================

export interface Commit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  committer_name: string;
  committer_email: string;
  committed_date: string;
  created_at: string;
  parent_ids?: string[];
  trailers?: Record<string, string>;
  web_url: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  status?: string;
  project_id?: number;
  last_pipeline?: Pipeline;
}

// ============================================
// Milestone Types
// ============================================

export interface Milestone {
  id: number;
  iid: number;
  project_id?: number;
  group_id?: number;
  title: string;
  description?: string;
  state: 'active' | 'closed';
  created_at: string;
  updated_at: string;
  due_date?: string;
  start_date?: string;
  expired?: boolean;
  web_url: string;
}

// ============================================
// Group Types
// ============================================

export interface Group {
  id: number;
  name: string;
  path: string;
  full_name: string;
  full_path: string;
  description?: string;
  visibility: 'private' | 'internal' | 'public';
  share_with_group_lock: boolean;
  require_two_factor_authentication: boolean;
  two_factor_grace_period: number;
  project_creation_level: string;
  auto_devops_enabled?: boolean;
  subgroup_creation_level: string;
  emails_disabled?: boolean;
  mentions_disabled?: boolean;
  lfs_enabled: boolean;
  default_branch_protection?: number;
  avatar_url?: string;
  web_url: string;
  request_access_enabled: boolean;
  repository_storage?: string;
  wiki_access_level?: string;
  created_at?: string;
  parent_id?: number;
  ldap_cn?: string;
  ldap_access?: string;
  marked_for_deletion_on?: string;
  statistics?: {
    storage_size: number;
    repository_size: number;
    wiki_size?: number;
    lfs_objects_size: number;
    job_artifacts_size: number;
    pipeline_artifacts_size?: number;
    packages_size: number;
    snippets_size?: number;
    uploads_size?: number;
  };
}

// ============================================
// Runner Types
// ============================================

export interface Runner {
  id: number;
  description?: string;
  ip_address?: string;
  active: boolean;
  paused: boolean;
  is_shared: boolean;
  runner_type: 'instance_type' | 'group_type' | 'project_type';
  name?: string;
  online?: boolean;
  status: 'online' | 'offline' | 'stale' | 'never_contacted' | 'not_connected';
  contacted_at?: string;
  architecture?: string;
  platform?: string;
  revision?: string;
  version?: string;
  access_level?: 'not_protected' | 'ref_protected';
  maximum_timeout?: number;
  tag_list?: string[];
  run_untagged?: boolean;
  locked?: boolean;
  projects?: Project[];
  groups?: Group[];
}

// ============================================
// Deployment Types
// ============================================

export interface Deployment {
  id: number;
  iid: number;
  ref: string;
  sha: string;
  created_at: string;
  updated_at: string;
  status: 'created' | 'running' | 'success' | 'failed' | 'canceled';
  user: User;
  environment: Environment;
  deployable?: Job;
}

export interface Environment {
  id: number;
  name: string;
  slug: string;
  external_url?: string;
  state: 'available' | 'stopped';
  created_at?: string;
  updated_at?: string;
  auto_stop_at?: string;
  tier?: 'production' | 'staging' | 'testing' | 'development' | 'other';
  last_deployment?: Deployment;
}

// ============================================
// Snippet Types
// ============================================

export interface Snippet {
  id: number;
  title: string;
  file_name?: string;
  description?: string;
  visibility: 'private' | 'internal' | 'public';
  author: User;
  created_at: string;
  updated_at: string;
  project_id?: number;
  web_url: string;
  raw_url: string;
  ssh_url_to_repo?: string;
  http_url_to_repo?: string;
  files?: Array<{
    path: string;
    raw_url: string;
  }>;
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  name: string;
  message?: string;
  target: string;
  commit: Commit;
  release?: {
    tag_name: string;
    description?: string;
  };
  protected?: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface GitLabErrorResponse {
  message?: string | Record<string, string[]>;
  error?: string;
  error_description?: string;
}

export class GitLabApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: string[];

  constructor(message: string, statusCode: number, errors?: string[]) {
    super(message);
    this.name = 'GitLabApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
