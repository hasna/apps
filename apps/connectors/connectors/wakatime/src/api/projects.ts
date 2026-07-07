import type { WakatimeClient } from './client';
import type {
  GetCommitOptions,
  ProjectCommitsOptions,
  UserScopedOptions,
} from '../types';

export class ProjectsApi {
  constructor(private readonly client: WakatimeClient) {}

  async list(options: UserScopedOptions = {}): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/projects`);
  }

  async listCommits(options: ProjectCommitsOptions): Promise<unknown> {
    const user = this.client.userPath(options.user);
    const project = encodeURIComponent(options.project);
    return this.client.get(`${user}/projects/${project}/commits`, {
      page: options.page,
      branch: options.branch,
      author: options.author,
    });
  }

  async getCommit(options: GetCommitOptions): Promise<unknown> {
    const user = this.client.userPath(options.user);
    const project = encodeURIComponent(options.project);
    const hash = encodeURIComponent(options.hash);
    return this.client.get(`${user}/projects/${project}/commits/${hash}`);
  }
}
