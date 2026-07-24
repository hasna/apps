import type { SmartRecruitersConfig } from '../types';
import { SmartRecruitersClient } from './client';
import { JobsApi } from './jobs';
import { CandidatesApi } from './candidates';
import { PostingsApi } from './postings';
import { ConfigurationApi } from './configuration';
import { UsersApi } from './users';
import { getApiKey, getCompanyId } from '../utils/config';

export class SmartRecruiters {
  private readonly client: SmartRecruitersClient;

  // API modules
  public readonly jobs: JobsApi;
  public readonly candidates: CandidatesApi;
  public readonly postings: PostingsApi;
  public readonly configuration: ConfigurationApi;
  public readonly users: UsersApi;

  constructor(config: SmartRecruitersConfig) {
    this.client = new SmartRecruitersClient(config);
    this.jobs = new JobsApi(this.client);
    this.candidates = new CandidatesApi(this.client);
    this.postings = new PostingsApi(this.client, config.companyId);
    this.configuration = new ConfigurationApi(this.client);
    this.users = new UsersApi(this.client);
  }

  /**
   * Create a client from config file or environment variables.
   * Priority: env vars > config file.
   */
  static create(): SmartRecruiters {
    const apiKey = getApiKey();

    if (!apiKey) {
      throw new Error(
        'SmartRecruiters credentials not configured. ' +
        'Set SMARTRECRUITERS_API_KEY, or run ' +
        '"connect-smartrecruiters config set-key <key>".'
      );
    }

    return new SmartRecruiters({ apiKey, companyId: getCompanyId() });
  }

  /**
   * Create a client from environment variables only.
   */
  static fromEnv(): SmartRecruiters {
    const apiKey = process.env.SMARTRECRUITERS_API_KEY;

    if (!apiKey) {
      throw new Error('SMARTRECRUITERS_API_KEY environment variable is required');
    }

    return new SmartRecruiters({
      apiKey,
      companyId: process.env.SMARTRECRUITERS_COMPANY_ID,
      baseUrl: process.env.SMARTRECRUITERS_BASE_URL,
    });
  }

  /** Get a preview of the credentials (for debugging). */
  getCredentialPreview(): string {
    return this.client.getCredentialPreview();
  }

  /** Get the underlying client for direct API access. */
  getClient(): SmartRecruitersClient {
    return this.client;
  }
}

// Export the client and all API modules
export { SmartRecruitersClient } from './client';
export { JobsApi } from './jobs';
export { CandidatesApi } from './candidates';
export { PostingsApi } from './postings';
export { ConfigurationApi } from './configuration';
export { UsersApi } from './users';
