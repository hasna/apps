import type {
  GitLabConfig,
  User,
  Project,
  ProjectCreateParams,
  Issue,
  IssueCreateParams,
  MergeRequest,
  MergeRequestCreateParams,
  Pipeline,
  Job,
  Branch,
  Commit,
  Milestone,
  Group,
  Runner,
  Deployment,
  Environment,
  Snippet,
  Tag,
} from '../types';
import { GitLabClient } from './client';

/**
 * GitLab API wrapper
 */
export class GitLab {
  private readonly client: GitLabClient;

  constructor(config: GitLabConfig) {
    this.client = new GitLabClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): GitLab {
    const accessToken = process.env.GITLAB_ACCESS_TOKEN || process.env.GITLAB_TOKEN;
    const baseUrl = process.env.GITLAB_URL;

    if (!accessToken) {
      throw new Error('GITLAB_ACCESS_TOKEN or GITLAB_TOKEN environment variable is required');
    }
    return new GitLab({ accessToken, baseUrl });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GitLabClient {
    return this.client;
  }

  // ============================================
  // Users API
  // ============================================

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User> {
    return this.client.get<User>('/user');
  }

  /**
   * List users (admin only for full list)
   */
  async listUsers(params?: {
    username?: string;
    search?: string;
    active?: boolean;
    blocked?: boolean;
    external?: boolean;
    per_page?: number;
    page?: number;
  }): Promise<User[]> {
    return this.client.get<User[]>('/users', params);
  }

  /**
   * Get a user by ID
   */
  async getUser(userId: number): Promise<User> {
    return this.client.get<User>(`/users/${userId}`);
  }

  // ============================================
  // Projects API
  // ============================================

  /**
   * List projects
   */
  async listProjects(params?: {
    archived?: boolean;
    visibility?: 'public' | 'internal' | 'private';
    order_by?: 'id' | 'name' | 'path' | 'created_at' | 'updated_at' | 'last_activity_at';
    sort?: 'asc' | 'desc';
    search?: string;
    simple?: boolean;
    owned?: boolean;
    membership?: boolean;
    starred?: boolean;
    with_issues_enabled?: boolean;
    with_merge_requests_enabled?: boolean;
    min_access_level?: number;
    per_page?: number;
    page?: number;
  }): Promise<Project[]> {
    return this.client.get<Project[]>('/projects', params);
  }

  /**
   * Get a project by ID or path
   */
  async getProject(projectId: number | string): Promise<Project> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Project>(`/projects/${id}`);
  }

  /**
   * Create a project
   */
  async createProject(params: ProjectCreateParams): Promise<Project> {
    return this.client.post<Project>('/projects', params);
  }

  /**
   * Update a project
   */
  async updateProject(projectId: number | string, params: Partial<ProjectCreateParams>): Promise<Project> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.put<Project>(`/projects/${id}`, params);
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: number | string): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}`);
  }

  /**
   * Star a project
   */
  async starProject(projectId: number | string): Promise<Project> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Project>(`/projects/${id}/star`);
  }

  /**
   * Unstar a project
   */
  async unstarProject(projectId: number | string): Promise<Project> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Project>(`/projects/${id}/unstar`);
  }

  /**
   * Fork a project
   */
  async forkProject(projectId: number | string, params?: {
    namespace_id?: number;
    namespace_path?: string;
    name?: string;
    path?: string;
    description?: string;
    visibility?: 'public' | 'internal' | 'private';
  }): Promise<Project> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Project>(`/projects/${id}/fork`, params);
  }

  // ============================================
  // Issues API
  // ============================================

  /**
   * List project issues
   */
  async listIssues(projectId: number | string, params?: {
    iids?: number[];
    state?: 'opened' | 'closed' | 'all';
    labels?: string;
    milestone?: string;
    scope?: 'created_by_me' | 'assigned_to_me' | 'all';
    author_id?: number;
    assignee_id?: number;
    search?: string;
    created_after?: string;
    created_before?: string;
    updated_after?: string;
    updated_before?: string;
    order_by?: 'created_at' | 'updated_at' | 'priority' | 'due_date' | 'relative_position' | 'label_priority' | 'milestone_due' | 'popularity' | 'weight';
    sort?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
  }): Promise<Issue[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Issue[]>(`/projects/${id}/issues`, params);
  }

  /**
   * Get a single issue
   */
  async getIssue(projectId: number | string, issueIid: number): Promise<Issue> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Issue>(`/projects/${id}/issues/${issueIid}`);
  }

  /**
   * Create an issue
   */
  async createIssue(projectId: number | string, params: IssueCreateParams): Promise<Issue> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Issue>(`/projects/${id}/issues`, params);
  }

  /**
   * Update an issue
   */
  async updateIssue(projectId: number | string, issueIid: number, params: Partial<IssueCreateParams> & { state_event?: 'close' | 'reopen' }): Promise<Issue> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.put<Issue>(`/projects/${id}/issues/${issueIid}`, params);
  }

  /**
   * Delete an issue
   */
  async deleteIssue(projectId: number | string, issueIid: number): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/issues/${issueIid}`);
  }

  // ============================================
  // Merge Requests API
  // ============================================

  /**
   * List project merge requests
   */
  async listMergeRequests(projectId: number | string, params?: {
    iids?: number[];
    state?: 'opened' | 'closed' | 'merged' | 'locked' | 'all';
    order_by?: 'created_at' | 'updated_at';
    sort?: 'asc' | 'desc';
    milestone?: string;
    labels?: string;
    with_labels_details?: boolean;
    with_merge_status_recheck?: boolean;
    created_after?: string;
    created_before?: string;
    updated_after?: string;
    updated_before?: string;
    scope?: 'created_by_me' | 'assigned_to_me' | 'all';
    author_id?: number;
    assignee_id?: number;
    reviewer_id?: number;
    source_branch?: string;
    target_branch?: string;
    search?: string;
    wip?: 'yes' | 'no';
    per_page?: number;
    page?: number;
  }): Promise<MergeRequest[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<MergeRequest[]>(`/projects/${id}/merge_requests`, params);
  }

  /**
   * Get a single merge request
   */
  async getMergeRequest(projectId: number | string, mrIid: number): Promise<MergeRequest> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<MergeRequest>(`/projects/${id}/merge_requests/${mrIid}`);
  }

  /**
   * Create a merge request
   */
  async createMergeRequest(projectId: number | string, params: MergeRequestCreateParams): Promise<MergeRequest> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<MergeRequest>(`/projects/${id}/merge_requests`, params);
  }

  /**
   * Update a merge request
   */
  async updateMergeRequest(projectId: number | string, mrIid: number, params: Partial<MergeRequestCreateParams> & { state_event?: 'close' | 'reopen' }): Promise<MergeRequest> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.put<MergeRequest>(`/projects/${id}/merge_requests/${mrIid}`, params);
  }

  /**
   * Accept/merge a merge request
   */
  async acceptMergeRequest(projectId: number | string, mrIid: number, params?: {
    merge_commit_message?: string;
    squash_commit_message?: string;
    squash?: boolean;
    should_remove_source_branch?: boolean;
    merge_when_pipeline_succeeds?: boolean;
    sha?: string;
  }): Promise<MergeRequest> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.put<MergeRequest>(`/projects/${id}/merge_requests/${mrIid}/merge`, params);
  }

  /**
   * Delete a merge request
   */
  async deleteMergeRequest(projectId: number | string, mrIid: number): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/merge_requests/${mrIid}`);
  }

  // ============================================
  // Pipelines API
  // ============================================

  /**
   * List project pipelines
   */
  async listPipelines(projectId: number | string, params?: {
    scope?: 'running' | 'pending' | 'finished' | 'branches' | 'tags';
    status?: 'created' | 'waiting_for_resource' | 'preparing' | 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 'manual' | 'scheduled';
    ref?: string;
    sha?: string;
    yaml_errors?: boolean;
    username?: string;
    updated_after?: string;
    updated_before?: string;
    order_by?: 'id' | 'status' | 'ref' | 'updated_at' | 'user_id';
    sort?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
  }): Promise<Pipeline[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Pipeline[]>(`/projects/${id}/pipelines`, params);
  }

  /**
   * Get a single pipeline
   */
  async getPipeline(projectId: number | string, pipelineId: number): Promise<Pipeline> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Pipeline>(`/projects/${id}/pipelines/${pipelineId}`);
  }

  /**
   * Create a pipeline
   */
  async createPipeline(projectId: number | string, ref: string, variables?: Array<{ key: string; value: string; variable_type?: 'env_var' | 'file' }>): Promise<Pipeline> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Pipeline>(`/projects/${id}/pipeline`, { ref, variables });
  }

  /**
   * Retry a pipeline
   */
  async retryPipeline(projectId: number | string, pipelineId: number): Promise<Pipeline> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Pipeline>(`/projects/${id}/pipelines/${pipelineId}/retry`);
  }

  /**
   * Cancel a pipeline
   */
  async cancelPipeline(projectId: number | string, pipelineId: number): Promise<Pipeline> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Pipeline>(`/projects/${id}/pipelines/${pipelineId}/cancel`);
  }

  /**
   * Delete a pipeline
   */
  async deletePipeline(projectId: number | string, pipelineId: number): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/pipelines/${pipelineId}`);
  }

  // ============================================
  // Jobs API
  // ============================================

  /**
   * List pipeline jobs
   */
  async listPipelineJobs(projectId: number | string, pipelineId: number, params?: {
    scope?: 'created' | 'pending' | 'running' | 'failed' | 'success' | 'canceled' | 'skipped' | 'manual'[];
    include_retried?: boolean;
    per_page?: number;
    page?: number;
  }): Promise<Job[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Job[]>(`/projects/${id}/pipelines/${pipelineId}/jobs`, params);
  }

  /**
   * Get a single job
   */
  async getJob(projectId: number | string, jobId: number): Promise<Job> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Job>(`/projects/${id}/jobs/${jobId}`);
  }

  /**
   * Retry a job
   */
  async retryJob(projectId: number | string, jobId: number): Promise<Job> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Job>(`/projects/${id}/jobs/${jobId}/retry`);
  }

  /**
   * Cancel a job
   */
  async cancelJob(projectId: number | string, jobId: number): Promise<Job> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Job>(`/projects/${id}/jobs/${jobId}/cancel`);
  }

  /**
   * Play a manual job
   */
  async playJob(projectId: number | string, jobId: number): Promise<Job> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Job>(`/projects/${id}/jobs/${jobId}/play`);
  }

  /**
   * Get job log
   */
  async getJobLog(projectId: number | string, jobId: number): Promise<string> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<string>(`/projects/${id}/jobs/${jobId}/trace`);
  }

  // ============================================
  // Branches API
  // ============================================

  /**
   * List project branches
   */
  async listBranches(projectId: number | string, params?: {
    search?: string;
    regex?: string;
    per_page?: number;
    page?: number;
  }): Promise<Branch[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Branch[]>(`/projects/${id}/repository/branches`, params);
  }

  /**
   * Get a single branch
   */
  async getBranch(projectId: number | string, branchName: string): Promise<Branch> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Branch>(`/projects/${id}/repository/branches/${encodeURIComponent(branchName)}`);
  }

  /**
   * Create a branch
   */
  async createBranch(projectId: number | string, branch: string, ref: string): Promise<Branch> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Branch>(`/projects/${id}/repository/branches`, { branch, ref });
  }

  /**
   * Delete a branch
   */
  async deleteBranch(projectId: number | string, branchName: string): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/repository/branches/${encodeURIComponent(branchName)}`);
  }

  // ============================================
  // Commits API
  // ============================================

  /**
   * List project commits
   */
  async listCommits(projectId: number | string, params?: {
    ref_name?: string;
    since?: string;
    until?: string;
    path?: string;
    all?: boolean;
    with_stats?: boolean;
    first_parent?: boolean;
    order?: 'default' | 'topo';
    per_page?: number;
    page?: number;
  }): Promise<Commit[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Commit[]>(`/projects/${id}/repository/commits`, params);
  }

  /**
   * Get a single commit
   */
  async getCommit(projectId: number | string, sha: string): Promise<Commit> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Commit>(`/projects/${id}/repository/commits/${sha}`);
  }

  // ============================================
  // Milestones API
  // ============================================

  /**
   * List project milestones
   */
  async listMilestones(projectId: number | string, params?: {
    iids?: number[];
    state?: 'active' | 'closed';
    title?: string;
    search?: string;
    include_parent_milestones?: boolean;
    per_page?: number;
    page?: number;
  }): Promise<Milestone[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Milestone[]>(`/projects/${id}/milestones`, params);
  }

  /**
   * Get a single milestone
   */
  async getMilestone(projectId: number | string, milestoneId: number): Promise<Milestone> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Milestone>(`/projects/${id}/milestones/${milestoneId}`);
  }

  /**
   * Create a milestone
   */
  async createMilestone(projectId: number | string, params: {
    title: string;
    description?: string;
    due_date?: string;
    start_date?: string;
  }): Promise<Milestone> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Milestone>(`/projects/${id}/milestones`, params);
  }

  /**
   * Update a milestone
   */
  async updateMilestone(projectId: number | string, milestoneId: number, params: {
    title?: string;
    description?: string;
    due_date?: string;
    start_date?: string;
    state_event?: 'close' | 'activate';
  }): Promise<Milestone> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.put<Milestone>(`/projects/${id}/milestones/${milestoneId}`, params);
  }

  /**
   * Delete a milestone
   */
  async deleteMilestone(projectId: number | string, milestoneId: number): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/milestones/${milestoneId}`);
  }

  // ============================================
  // Groups API
  // ============================================

  /**
   * List groups
   */
  async listGroups(params?: {
    skip_groups?: number[];
    all_available?: boolean;
    search?: string;
    order_by?: 'name' | 'path' | 'id';
    sort?: 'asc' | 'desc';
    statistics?: boolean;
    with_custom_attributes?: boolean;
    owned?: boolean;
    min_access_level?: number;
    top_level_only?: boolean;
    per_page?: number;
    page?: number;
  }): Promise<Group[]> {
    return this.client.get<Group[]>('/groups', params);
  }

  /**
   * Get a group by ID or path
   */
  async getGroup(groupId: number | string): Promise<Group> {
    const id = typeof groupId === 'string' ? encodeURIComponent(groupId) : groupId;
    return this.client.get<Group>(`/groups/${id}`);
  }

  /**
   * List group projects
   */
  async listGroupProjects(groupId: number | string, params?: {
    archived?: boolean;
    visibility?: 'public' | 'internal' | 'private';
    order_by?: 'id' | 'name' | 'path' | 'created_at' | 'updated_at' | 'last_activity_at';
    sort?: 'asc' | 'desc';
    search?: string;
    simple?: boolean;
    owned?: boolean;
    starred?: boolean;
    with_issues_enabled?: boolean;
    with_merge_requests_enabled?: boolean;
    with_shared?: boolean;
    include_subgroups?: boolean;
    min_access_level?: number;
    per_page?: number;
    page?: number;
  }): Promise<Project[]> {
    const id = typeof groupId === 'string' ? encodeURIComponent(groupId) : groupId;
    return this.client.get<Project[]>(`/groups/${id}/projects`, params);
  }

  // ============================================
  // Runners API
  // ============================================

  /**
   * List runners
   */
  async listRunners(params?: {
    scope?: 'active' | 'paused' | 'online' | 'offline';
    type?: 'instance_type' | 'group_type' | 'project_type';
    status?: 'online' | 'offline' | 'stale' | 'never_contacted';
    paused?: boolean;
    tag_list?: string[];
    per_page?: number;
    page?: number;
  }): Promise<Runner[]> {
    return this.client.get<Runner[]>('/runners', params);
  }

  /**
   * Get a runner
   */
  async getRunner(runnerId: number): Promise<Runner> {
    return this.client.get<Runner>(`/runners/${runnerId}`);
  }

  /**
   * List project runners
   */
  async listProjectRunners(projectId: number | string, params?: {
    scope?: 'active' | 'paused' | 'online' | 'offline';
    type?: 'instance_type' | 'group_type' | 'project_type';
    status?: 'online' | 'offline' | 'stale' | 'never_contacted';
    paused?: boolean;
    tag_list?: string[];
    per_page?: number;
    page?: number;
  }): Promise<Runner[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Runner[]>(`/projects/${id}/runners`, params);
  }

  // ============================================
  // Deployments API
  // ============================================

  /**
   * List project deployments
   */
  async listDeployments(projectId: number | string, params?: {
    order_by?: 'id' | 'iid' | 'created_at' | 'updated_at' | 'finished_at' | 'ref';
    sort?: 'asc' | 'desc';
    updated_after?: string;
    updated_before?: string;
    finished_after?: string;
    finished_before?: string;
    environment?: string;
    status?: 'created' | 'running' | 'success' | 'failed' | 'canceled';
    per_page?: number;
    page?: number;
  }): Promise<Deployment[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Deployment[]>(`/projects/${id}/deployments`, params);
  }

  /**
   * Get a deployment
   */
  async getDeployment(projectId: number | string, deploymentId: number): Promise<Deployment> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Deployment>(`/projects/${id}/deployments/${deploymentId}`);
  }

  // ============================================
  // Environments API
  // ============================================

  /**
   * List project environments
   */
  async listEnvironments(projectId: number | string, params?: {
    name?: string;
    search?: string;
    states?: 'available' | 'stopped';
    per_page?: number;
    page?: number;
  }): Promise<Environment[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Environment[]>(`/projects/${id}/environments`, params);
  }

  /**
   * Get an environment
   */
  async getEnvironment(projectId: number | string, environmentId: number): Promise<Environment> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Environment>(`/projects/${id}/environments/${environmentId}`);
  }

  /**
   * Create an environment
   */
  async createEnvironment(projectId: number | string, params: {
    name: string;
    external_url?: string;
    tier?: 'production' | 'staging' | 'testing' | 'development' | 'other';
  }): Promise<Environment> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Environment>(`/projects/${id}/environments`, params);
  }

  /**
   * Stop an environment
   */
  async stopEnvironment(projectId: number | string, environmentId: number): Promise<Environment> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Environment>(`/projects/${id}/environments/${environmentId}/stop`);
  }

  /**
   * Delete an environment
   */
  async deleteEnvironment(projectId: number | string, environmentId: number): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/environments/${environmentId}`);
  }

  // ============================================
  // Snippets API
  // ============================================

  /**
   * List project snippets
   */
  async listSnippets(projectId: number | string, params?: {
    per_page?: number;
    page?: number;
  }): Promise<Snippet[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Snippet[]>(`/projects/${id}/snippets`, params);
  }

  /**
   * Get a snippet
   */
  async getSnippet(projectId: number | string, snippetId: number): Promise<Snippet> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Snippet>(`/projects/${id}/snippets/${snippetId}`);
  }

  /**
   * Create a snippet
   */
  async createSnippet(projectId: number | string, params: {
    title: string;
    file_name: string;
    content: string;
    description?: string;
    visibility: 'private' | 'internal' | 'public';
  }): Promise<Snippet> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Snippet>(`/projects/${id}/snippets`, params);
  }

  /**
   * Delete a snippet
   */
  async deleteSnippet(projectId: number | string, snippetId: number): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/snippets/${snippetId}`);
  }

  // ============================================
  // Tags API
  // ============================================

  /**
   * List project tags
   */
  async listTags(projectId: number | string, params?: {
    order_by?: 'name' | 'updated';
    sort?: 'asc' | 'desc';
    search?: string;
    per_page?: number;
    page?: number;
  }): Promise<Tag[]> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Tag[]>(`/projects/${id}/repository/tags`, params);
  }

  /**
   * Get a single tag
   */
  async getTag(projectId: number | string, tagName: string): Promise<Tag> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.get<Tag>(`/projects/${id}/repository/tags/${encodeURIComponent(tagName)}`);
  }

  /**
   * Create a tag
   */
  async createTag(projectId: number | string, params: {
    tag_name: string;
    ref: string;
    message?: string;
    release_description?: string;
  }): Promise<Tag> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    return this.client.post<Tag>(`/projects/${id}/repository/tags`, params);
  }

  /**
   * Delete a tag
   */
  async deleteTag(projectId: number | string, tagName: string): Promise<void> {
    const id = typeof projectId === 'string' ? encodeURIComponent(projectId) : projectId;
    await this.client.delete(`/projects/${id}/repository/tags/${encodeURIComponent(tagName)}`);
  }
}

export { GitLabClient } from './client';
