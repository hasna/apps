export interface BuildkiteConfig {
  token: string;
  baseUrl?: string;
}

export interface Organization {
  id: string;
  graphql_id: string;
  url: string;
  web_url: string;
  name: string;
  slug: string;
  agents_url: string;
  emojis_url: string;
  created_at: string;
}

export interface Pipeline {
  id: string;
  graphql_id: string;
  url: string;
  web_url: string;
  name: string;
  slug: string;
  description: string | null;
  repository: string;
  branch_configuration: string | null;
  default_branch: string;
  skip_queued_branch_builds: boolean;
  cancel_running_branch_builds: boolean;
  builds_url: string;
  badge_url: string;
  created_at: string;
  scheduled_builds_count: number;
  running_builds_count: number;
  finished_builds_count: number;
  visibility: 'public' | 'private';
}

export interface Build {
  id: string;
  graphql_id: string;
  url: string;
  web_url: string;
  number: number;
  state: 'scheduled' | 'running' | 'passed' | 'failed' | 'blocked' | 'canceled' | 'canceling' | 'skipped' | 'not_run';
  message: string;
  commit: string;
  branch: string;
  source: string;
  created_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  jobs: Job[];
  creator: { id: string; name: string; email: string } | null;
}

export interface Job {
  id: string;
  graphql_id: string;
  type: string;
  name: string;
  state: string;
  step_key: string | null;
  command: string | null;
  exit_status: number | null;
  agent: { id: string; name: string } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Artifact {
  id: string;
  job_id: string;
  url: string;
  download_url: string;
  state: string;
  path: string;
  dirname: string;
  filename: string;
  mime_type: string;
  file_size: number;
  sha1sum: string;
  created_at: string;
}

export interface Agent {
  id: string;
  graphql_id: string;
  url: string;
  web_url: string;
  name: string;
  connection_state: 'connected' | 'disconnected' | 'lost';
  hostname: string;
  ip_address: string;
  user_agent: string;
  creator: { id: string; name: string; email: string } | null;
  created_at: string;
  job: Job | null;
  last_job_finished_at: string | null;
  meta_data: string[];
}

export interface CreateBuildOptions {
  commit: string;
  branch: string;
  message?: string;
  author?: { name: string; email: string };
  env?: Record<string, string>;
  meta_data?: Record<string, string>;
  clean_checkout?: boolean;
  ignore_pipeline_branch_filters?: boolean;
}

export interface ListBuildsOptions {
  state?: string;
  branch?: string;
  commit?: string;
  created_from?: string;
  created_to?: string;
  finished_from?: string;
  meta_data?: Record<string, string>;
  page?: number;
  per_page?: number;
}

export class BuildkiteApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'BuildkiteApiError';
    this.statusCode = statusCode;
  }
}
