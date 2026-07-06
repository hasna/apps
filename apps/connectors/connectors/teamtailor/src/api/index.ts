import type {
  TeamtailorConfig,
  CandidateAttributes,
  JobAttributes,
  JobApplicationAttributes,
  UserAttributes,
} from '../types';
import { TeamtailorClient } from './client';
import { ResourceApi } from './resources';
import { getApiKey, getApiVersion, getBaseUrl } from '../utils/config';

export class Teamtailor {
  private readonly client: TeamtailorClient;

  // JSON:API resource modules
  public readonly candidates: ResourceApi<CandidateAttributes>;
  public readonly jobs: ResourceApi<JobAttributes>;
  public readonly jobApplications: ResourceApi<JobApplicationAttributes>;
  public readonly users: ResourceApi<UserAttributes>;
  public readonly departments: ResourceApi;
  public readonly locations: ResourceApi;
  public readonly stages: ResourceApi;

  constructor(config: TeamtailorConfig) {
    this.client = new TeamtailorClient(config);
    this.candidates = new ResourceApi(this.client, '/candidates', 'candidates');
    this.jobs = new ResourceApi(this.client, '/jobs', 'jobs');
    this.jobApplications = new ResourceApi(this.client, '/job-applications', 'job-applications');
    this.users = new ResourceApi(this.client, '/users', 'users');
    this.departments = new ResourceApi(this.client, '/departments', 'departments');
    this.locations = new ResourceApi(this.client, '/locations', 'locations');
    this.stages = new ResourceApi(this.client, '/stages', 'stages');
  }

  /**
   * Create a Teamtailor client from config file or environment variables.
   * Priority: env vars > config file.
   */
  static create(): Teamtailor {
    const apiKey = getApiKey();

    if (!apiKey) {
      throw new Error(
        'Teamtailor credentials not configured. ' +
        'Set TEAMTAILOR_API_KEY environment variable, ' +
        'or run "connect-teamtailor config set-key <key>"'
      );
    }

    return new Teamtailor({
      apiKey,
      apiVersion: getApiVersion(),
      baseUrl: getBaseUrl(),
    });
  }

  /**
   * Create a Teamtailor client from environment variables only.
   */
  static fromEnv(): Teamtailor {
    const apiKey = process.env.TEAMTAILOR_API_KEY;

    if (!apiKey) {
      throw new Error('TEAMTAILOR_API_KEY environment variable is required');
    }

    return new Teamtailor({
      apiKey,
      apiVersion: process.env.TEAMTAILOR_API_VERSION,
      baseUrl: process.env.TEAMTAILOR_BASE_URL,
    });
  }

  /** Get a preview of the credentials (for debugging). */
  getCredentialPreview(): string {
    return this.client.getCredentialPreview();
  }

  /** Get the underlying client for direct API access. */
  getClient(): TeamtailorClient {
    return this.client;
  }
}

// Export the client and resource wrapper
export { TeamtailorClient } from './client';
export { ResourceApi } from './resources';
