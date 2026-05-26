import type { GitHubClient } from './client';
import type {
  Commit,
  Branch,
  CommitStatus,
  CreateCommitStatusOptions,
  CompareResult,
} from '../types';

/**
 * GitHub Commits & Branches API
 */
export class CommitsApi {
  constructor(private readonly client: GitHubClient) {}

  // ============================================
  // Commits
  // ============================================

  /**
   * List commits on a repository
   */
  async list(
    owner: string,
    repo: string,
    options?: {
      sha?: string;
      path?: string;
      author?: string;
      committer?: string;
      since?: string;
      until?: string;
      per_page?: number;
      page?: number;
    }
  ): Promise<Commit[]> {
    return this.client.get<Commit[]>(`/repos/${owner}/${repo}/commits`, options);
  }

  /**
   * Get a single commit
   */
  async get(owner: string, repo: string, ref: string): Promise<Commit> {
    return this.client.get<Commit>(`/repos/${owner}/${repo}/commits/${ref}`);
  }

  /**
   * Compare two commits (diff between base and head)
   */
  async compare(
    owner: string,
    repo: string,
    base: string,
    head: string,
    options?: { per_page?: number; page?: number }
  ): Promise<CompareResult> {
    return this.client.get<CompareResult>(
      `/repos/${owner}/${repo}/compare/${base}...${head}`,
      options
    );
  }

  /**
   * List statuses for a commit ref
   */
  async listStatuses(
    owner: string,
    repo: string,
    ref: string,
    options?: { per_page?: number; page?: number }
  ): Promise<CommitStatus[]> {
    return this.client.get<CommitStatus[]>(
      `/repos/${owner}/${repo}/commits/${ref}/statuses`,
      options
    );
  }

  /**
   * Get the combined status for a ref
   */
  async getCombinedStatus(
    owner: string,
    repo: string,
    ref: string
  ): Promise<{ state: string; statuses: CommitStatus[]; total_count: number }> {
    return this.client.get(`/repos/${owner}/${repo}/commits/${ref}/status`);
  }

  /**
   * Create a commit status
   */
  async createStatus(
    owner: string,
    repo: string,
    sha: string,
    options: CreateCommitStatusOptions
  ): Promise<CommitStatus> {
    return this.client.post<CommitStatus>(
      `/repos/${owner}/${repo}/statuses/${sha}`,
      options
    );
  }

  // ============================================
  // Branches
  // ============================================

  /**
   * List branches
   */
  async listBranches(
    owner: string,
    repo: string,
    options?: { protected?: boolean; per_page?: number; page?: number }
  ): Promise<Branch[]> {
    return this.client.get<Branch[]>(`/repos/${owner}/${repo}/branches`, options);
  }

  /**
   * Get a branch
   */
  async getBranch(owner: string, repo: string, branch: string): Promise<Branch> {
    return this.client.get<Branch>(`/repos/${owner}/${repo}/branches/${branch}`);
  }

  /**
   * Create a branch (by creating a ref)
   */
  async createBranch(owner: string, repo: string, branch: string, sha: string): Promise<{ ref: string; object: { sha: string } }> {
    return this.client.post(`/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
  }

  /**
   * Rename a branch
   */
  async renameBranch(owner: string, repo: string, branch: string, newName: string): Promise<Branch> {
    return this.client.post<Branch>(
      `/repos/${owner}/${repo}/branches/${branch}/rename`,
      { new_name: newName }
    );
  }

  /**
   * Delete a branch
   */
  async deleteBranch(owner: string, repo: string, branch: string): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  }

  /**
   * Merge a branch into a base
   */
  async merge(
    owner: string,
    repo: string,
    base: string,
    head: string,
    commitMessage?: string
  ): Promise<Commit | null> {
    return this.client.post<Commit | null>(`/repos/${owner}/${repo}/merges`, {
      base,
      head,
      commit_message: commitMessage,
    });
  }
}
