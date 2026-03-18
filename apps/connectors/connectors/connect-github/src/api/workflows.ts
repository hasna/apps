import type { GitHubClient } from './client';
import type {
  Workflow,
  WorkflowRun,
  WorkflowJob,
  ListWorkflowRunsOptions,
  WorkflowDispatchOptions,
} from '../types';

/**
 * GitHub Actions / Workflows API
 */
export class WorkflowsApi {
  constructor(private readonly client: GitHubClient) {}

  // ============================================
  // Workflows
  // ============================================

  /**
   * List workflows in a repository
   */
  async list(
    owner: string,
    repo: string,
    options?: { per_page?: number; page?: number }
  ): Promise<{ total_count: number; workflows: Workflow[] }> {
    return this.client.get(`/repos/${owner}/${repo}/actions/workflows`, options);
  }

  /**
   * Get a workflow by ID or filename (e.g. "ci.yml")
   */
  async get(owner: string, repo: string, workflowId: number | string): Promise<Workflow> {
    return this.client.get<Workflow>(`/repos/${owner}/${repo}/actions/workflows/${workflowId}`);
  }

  /**
   * Enable a workflow
   */
  async enable(owner: string, repo: string, workflowId: number | string): Promise<void> {
    await this.client.put(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/enable`, {});
  }

  /**
   * Disable a workflow
   */
  async disable(owner: string, repo: string, workflowId: number | string): Promise<void> {
    await this.client.put(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/disable`, {});
  }

  /**
   * Trigger a workflow run (workflow_dispatch event)
   */
  async trigger(
    owner: string,
    repo: string,
    workflowId: number | string,
    options: WorkflowDispatchOptions
  ): Promise<void> {
    await this.client.post(
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
      options
    );
  }

  // ============================================
  // Workflow Runs
  // ============================================

  /**
   * List workflow runs for a workflow
   */
  async listRuns(
    owner: string,
    repo: string,
    workflowId: number | string,
    options?: ListWorkflowRunsOptions
  ): Promise<{ total_count: number; workflow_runs: WorkflowRun[] }> {
    return this.client.get(
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * List all workflow runs for a repository
   */
  async listAllRuns(
    owner: string,
    repo: string,
    options?: ListWorkflowRunsOptions
  ): Promise<{ total_count: number; workflow_runs: WorkflowRun[] }> {
    return this.client.get(
      `/repos/${owner}/${repo}/actions/runs`,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a workflow run
   */
  async getRun(owner: string, repo: string, runId: number): Promise<WorkflowRun> {
    return this.client.get<WorkflowRun>(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  }

  /**
   * Cancel a workflow run
   */
  async cancelRun(owner: string, repo: string, runId: number): Promise<void> {
    await this.client.post(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {});
  }

  /**
   * Re-run a workflow run
   */
  async rerunRun(owner: string, repo: string, runId: number): Promise<void> {
    await this.client.post(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, {});
  }

  /**
   * Delete a workflow run
   */
  async deleteRun(owner: string, repo: string, runId: number): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  }

  /**
   * Download workflow run logs URL
   */
  async getRunLogsUrl(owner: string, repo: string, runId: number): Promise<string> {
    // Returns a redirect — we return the Location header URL
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`,
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${(this.client as unknown as { token: string }).token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    return response.headers.get('location') || '';
  }

  // ============================================
  // Jobs
  // ============================================

  /**
   * List jobs for a workflow run
   */
  async listJobs(
    owner: string,
    repo: string,
    runId: number,
    options?: { filter?: 'latest' | 'all'; per_page?: number; page?: number }
  ): Promise<{ total_count: number; jobs: WorkflowJob[] }> {
    return this.client.get(
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a job for a workflow run
   */
  async getJob(owner: string, repo: string, jobId: number): Promise<WorkflowJob> {
    return this.client.get<WorkflowJob>(`/repos/${owner}/${repo}/actions/jobs/${jobId}`);
  }
}
