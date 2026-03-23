// GitHub Connector Types

// ============================================
// Configuration
// ============================================

export interface GitHubConfig {
  token: string;
  baseUrl?: string; // For GitHub Enterprise
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextPage?: number;
  hasMore: boolean;
}

// ============================================
// User Types
// ============================================

export interface User {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
  name?: string | null;
  company?: string | null;
  blog?: string | null;
  location?: string | null;
  email?: string | null;
  hireable?: boolean | null;
  bio?: string | null;
  twitter_username?: string | null;
  public_repos?: number;
  public_gists?: number;
  followers?: number;
  following?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Repository Types
// ============================================

export interface Repository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  owner: User;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  forks_url: string;
  keys_url: string;
  collaborators_url: string;
  teams_url: string;
  hooks_url: string;
  issue_events_url: string;
  events_url: string;
  assignees_url: string;
  branches_url: string;
  tags_url: string;
  blobs_url: string;
  git_tags_url: string;
  git_refs_url: string;
  trees_url: string;
  statuses_url: string;
  languages_url: string;
  stargazers_url: string;
  contributors_url: string;
  subscribers_url: string;
  subscription_url: string;
  commits_url: string;
  git_commits_url: string;
  comments_url: string;
  issue_comment_url: string;
  contents_url: string;
  compare_url: string;
  merges_url: string;
  archive_url: string;
  downloads_url: string;
  issues_url: string;
  pulls_url: string;
  milestones_url: string;
  notifications_url: string;
  labels_url: string;
  releases_url: string;
  deployments_url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  git_url: string;
  ssh_url: string;
  clone_url: string;
  svn_url: string;
  homepage: string | null;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  has_issues: boolean;
  has_projects: boolean;
  has_downloads: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  has_discussions: boolean;
  forks_count: number;
  mirror_url: string | null;
  archived: boolean;
  disabled: boolean;
  open_issues_count: number;
  license: {
    key: string;
    name: string;
    spdx_id: string;
    url: string | null;
    node_id: string;
  } | null;
  allow_forking: boolean;
  is_template: boolean;
  web_commit_signoff_required: boolean;
  topics: string[];
  visibility: string;
  forks: number;
  open_issues: number;
  watchers: number;
  default_branch: string;
}

export interface CreateRepoOptions {
  description?: string;
  homepage?: string;
  private?: boolean;
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  auto_init?: boolean;
  gitignore_template?: string;
  license_template?: string;
}

export interface FileContent {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  encoding?: string;
  size: number;
  name: string;
  path: string;
  content?: string;
  sha: string;
  url: string;
  git_url: string | null;
  html_url: string | null;
  download_url: string | null;
}

export interface CreateOrUpdateFileOptions {
  message: string;
  content: string; // Base64 encoded
  sha?: string; // Required when updating
  branch?: string;
  committer?: {
    name: string;
    email: string;
  };
  author?: {
    name: string;
    email: string;
  };
}

export interface FileCommitResponse {
  content: FileContent | null;
  commit: {
    sha: string;
    node_id: string;
    url: string;
    html_url: string;
    author: {
      date: string;
      name: string;
      email: string;
    };
    committer: {
      date: string;
      name: string;
      email: string;
    };
    message: string;
    tree: {
      url: string;
      sha: string;
    };
    parents: Array<{
      url: string;
      html_url: string;
      sha: string;
    }>;
  };
}

// ============================================
// Issue Types
// ============================================

export interface Label {
  id: number;
  node_id: string;
  url: string;
  name: string;
  description: string | null;
  color: string;
  default: boolean;
}

export interface Milestone {
  url: string;
  html_url: string;
  labels_url: string;
  id: number;
  node_id: string;
  number: number;
  state: 'open' | 'closed';
  title: string;
  description: string | null;
  creator: User;
  open_issues: number;
  closed_issues: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  due_on: string | null;
}

export interface Issue {
  id: number;
  node_id: string;
  url: string;
  repository_url: string;
  labels_url: string;
  comments_url: string;
  events_url: string;
  html_url: string;
  number: number;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'reopened' | 'not_planned' | null;
  title: string;
  body: string | null;
  user: User;
  labels: Label[];
  assignee: User | null;
  assignees: User[];
  milestone: Milestone | null;
  locked: boolean;
  active_lock_reason?: string | null;
  comments: number;
  pull_request?: {
    url: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
  };
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  author_association: string;
}

export interface ListIssuesOptions {
  state?: 'open' | 'closed' | 'all';
  labels?: string;
  sort?: 'created' | 'updated' | 'comments';
  direction?: 'asc' | 'desc';
  since?: string;
  per_page?: number;
  page?: number;
}

export interface CreateIssueOptions {
  labels?: string[];
  assignees?: string[];
  milestone?: number;
}

export interface UpdateIssueOptions {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened';
  labels?: string[];
  assignees?: string[];
  milestone?: number | null;
}

export interface IssueComment {
  id: number;
  node_id: string;
  url: string;
  html_url: string;
  body: string;
  user: User;
  created_at: string;
  updated_at: string;
  author_association: string;
}

// ============================================
// Pull Request Types
// ============================================

export interface PullRequest {
  id: number;
  node_id: string;
  url: string;
  html_url: string;
  diff_url: string;
  patch_url: string;
  issue_url: string;
  commits_url: string;
  review_comments_url: string;
  review_comment_url: string;
  comments_url: string;
  statuses_url: string;
  number: number;
  state: 'open' | 'closed';
  locked: boolean;
  title: string;
  user: User;
  body: string | null;
  labels: Label[];
  milestone: Milestone | null;
  active_lock_reason?: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  assignee: User | null;
  assignees: User[];
  requested_reviewers: User[];
  head: {
    label: string;
    ref: string;
    sha: string;
    user: User;
    repo: Repository;
  };
  base: {
    label: string;
    ref: string;
    sha: string;
    user: User;
    repo: Repository;
  };
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  rebaseable: boolean | null;
  mergeable_state: string;
  merged_by: User | null;
  comments: number;
  review_comments: number;
  maintainer_can_modify: boolean;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface ListPullsOptions {
  state?: 'open' | 'closed' | 'all';
  head?: string;
  base?: string;
  sort?: 'created' | 'updated' | 'popularity' | 'long-running';
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

export interface MergePullOptions {
  commit_title?: string;
  commit_message?: string;
  merge_method?: 'merge' | 'squash' | 'rebase';
  sha?: string;
}

export interface MergeResult {
  sha: string;
  merged: boolean;
  message: string;
}

export interface PullRequestReview {
  id: number;
  node_id: string;
  user: User;
  body: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  html_url: string;
  pull_request_url: string;
  submitted_at: string;
  commit_id: string;
  author_association: string;
}

// ============================================
// Commit Types
// ============================================

export interface Commit {
  sha: string;
  node_id: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
    tree: {
      sha: string;
      url: string;
    };
    url: string;
    comment_count: number;
    verification: {
      verified: boolean;
      reason: string;
      signature: string | null;
      payload: string | null;
    };
  };
  url: string;
  html_url: string;
  comments_url: string;
  author: User | null;
  committer: User | null;
  parents: Array<{
    sha: string;
    url: string;
    html_url: string;
  }>;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class GitHubApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly documentationUrl?: string;

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[], documentationUrl?: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.documentationUrl = documentationUrl;
  }
}
