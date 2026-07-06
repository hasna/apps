// Testim Connector Types

export interface TestimConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TestSummary {
  name: string;
  _id: string;
  labels?: string;
}

export interface ListTestsResponse {
  tests: TestSummary[];
  metaData?: Record<string, unknown>;
}

export interface LatestTestResult {
  resultId?: string;
  resultStatus?: string;
  resultDate?: string;
  failureReason?: string;
}

export interface TestDetail {
  name: string;
  owner?: string;
  status?: string;
  description?: string;
  testId: string;
  latestTestResult?: LatestTestResult;
}

export interface SearchTestResult {
  id: string;
  link: string;
}

export interface SearchTestsResponse {
  tests: SearchTestResult[];
  metaData?: Record<string, unknown>;
}

export interface SearchSuiteResult {
  id: string;
  link: string;
}

export interface SearchSuitesResponse {
  suites: SearchSuiteResult[];
  metaData?: Record<string, unknown>;
}

export interface SearchTestPlanResult {
  id: string;
  link: string;
}

export interface SearchTestPlansResponse {
  testPlans: SearchTestPlanResult[];
  metaData?: Record<string, unknown>;
}

export interface UpdateTestStatusParams {
  status: string;
  branch?: string;
}

export interface UpdateTestStatusResponse {
  response?: string;
  metaData?: Record<string, unknown>;
}

export interface RunTestParams {
  branch?: string;
  grid: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface RunTestResponse {
  executionId: string;
  metaData?: Record<string, unknown>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class TestimApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'TestimApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}
