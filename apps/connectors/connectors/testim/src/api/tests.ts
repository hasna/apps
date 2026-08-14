import type {
  ListTestsResponse,
  RunTestParams,
  RunTestResponse,
  SearchSuitesResponse,
  SearchTestPlansResponse,
  SearchTestsResponse,
  TestDetail,
  UpdateTestStatusParams,
  UpdateTestStatusResponse,
} from '../types';
import type { RequestOptions, TestimClient } from './client';

export interface ListTestsParams {
  branch?: string;
  includeTestStatus?: boolean;
}

export class TestsApi {
  constructor(private readonly client: TestimClient) {}

  list(params: ListTestsParams = {}): Promise<ListTestsResponse> {
    return this.client.get<ListTestsResponse>('/tests', { ...params });
  }

  get(testId: string, params: { branch?: string } = {}): Promise<TestDetail> {
    return this.client.get<TestDetail>(`/tests/${encodeURIComponent(testId)}`, params);
  }

  search(name: string): Promise<SearchTestsResponse> {
    return this.client.get<SearchTestsResponse>('/tests/search', { name });
  }

  searchSuites(name: string): Promise<SearchSuitesResponse> {
    return this.client.get<SearchSuitesResponse>('/suites/search', { name });
  }

  searchTestPlans(name: string): Promise<SearchTestPlansResponse> {
    return this.client.get<SearchTestPlansResponse>('/test-plans/search', { name });
  }

  updateStatus(testId: string, params: UpdateTestStatusParams): Promise<UpdateTestStatusResponse> {
    return this.client.put<UpdateTestStatusResponse>(
      `/tests/${encodeURIComponent(testId)}/status`,
      { ...params }
    );
  }

  run(testId: string, body: RunTestParams): Promise<RunTestResponse> {
    return this.client.post<RunTestResponse>(`/tests/run/${encodeURIComponent(testId)}`, body);
  }

  rawRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, options);
  }
}
