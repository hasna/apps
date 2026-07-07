// SonarQube Connector Types

export interface SonarQubeConfig {
  token: string;
  baseUrl: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryParamValue = string | number | boolean | string[] | undefined;

export interface Paging {
  pageIndex?: number;
  pageSize?: number;
  total?: number;
}

export interface SonarQubeError {
  msg: string;
}

export interface SonarQubeErrorResponse {
  errors?: SonarQubeError[];
}

export interface SystemStatus {
  id: string;
  version: string;
  status: string;
}

export interface SystemHealth {
  health: string;
  causes?: Array<{ message: string }>;
}

export interface Project {
  key: string;
  name: string;
  qualifier?: string;
  visibility?: string;
  lastAnalysisDate?: string;
  revision?: string;
}

export interface ProjectsSearchResponse {
  paging: Paging;
  components: Project[];
}

export interface Issue {
  key: string;
  rule: string;
  severity: string;
  component: string;
  project: string;
  line?: number;
  message: string;
  status: string;
  type: string;
  creationDate?: string;
  updateDate?: string;
}

export interface IssuesSearchResponse {
  total: number;
  p: number;
  ps: number;
  paging: Paging;
  issues: Issue[];
}

export interface Measure {
  metric: string;
  value?: string;
  bestValue?: boolean;
}

export interface ComponentMeasures {
  component: {
    key: string;
    name: string;
    qualifier: string;
  };
  measures: Measure[];
}

export interface Rule {
  key: string;
  name: string;
  lang?: string;
  langName?: string;
  severity?: string;
  status?: string;
}

export interface RulesSearchResponse {
  total: number;
  p: number;
  ps: number;
  rules: Rule[];
}

export interface User {
  login: string;
  name?: string;
  active?: boolean;
  local?: boolean;
}

export interface UsersSearchResponse {
  paging: Paging;
  users: User[];
}

export interface UserGroup {
  name: string;
  description?: string;
  default?: boolean;
}

export interface UserGroupsSearchResponse {
  paging: Paging;
  groups: UserGroup[];
}

export interface QualityGate {
  id: string;
  name: string;
  isDefault?: boolean;
  isBuiltIn?: boolean;
}

export interface QualityGatesListResponse {
  qualitygates: QualityGate[];
}

export interface QualityProfile {
  key: string;
  name: string;
  language: string;
  languageName?: string;
  isDefault?: boolean;
  isInherited?: boolean;
}

export interface QualityProfilesSearchResponse {
  profiles: QualityProfile[];
}

export interface Webhook {
  key: string;
  name: string;
  url: string;
  hasSecret?: boolean;
}

export interface WebhooksListResponse {
  webhooks: Webhook[];
}

export interface CeTask {
  id: string;
  type: string;
  componentId?: string;
  componentKey?: string;
  componentName?: string;
  status: string;
  submittedAt?: string;
  startedAt?: string;
  executedAt?: string;
  executionTimeMs?: number;
  errorMessage?: string;
}

export interface CeActivityResponse {
  tasks: CeTask[];
  paging: Paging;
}

export interface CeAnalysisStatus {
  task?: CeTask;
  queue?: {
    name: string;
    time: number;
  };
}

export class SonarQubeApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: SonarQubeError[];

  constructor(message: string, statusCode: number, errors?: SonarQubeError[]) {
    super(message);
    this.name = 'SonarQubeApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
