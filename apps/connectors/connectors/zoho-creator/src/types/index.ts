export type ZohoCreatorDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';
export type ZohoCreatorEnvironment = 'production' | 'stage' | 'stage_v2';
export type FieldConfig = 'all' | 'quick_view' | 'detail_view' | 'custom';
export type SkipWorkflow = 'form_workflow' | 'schedules';

export interface ZohoCreatorConfig {
  accessToken: string;
  dataCenter?: ZohoCreatorDataCenter;
  environment?: ZohoCreatorEnvironment;
}

export interface ZohoCreatorApiResponse {
  code?: number;
  message?: string;
  description?: string;
  data?: unknown;
  [key: string]: unknown;
}

export class ZohoCreatorApiError extends Error {
  readonly statusCode?: number;
  readonly code?: number;

  constructor(message: string, statusCode?: number, code?: number) {
    super(message);
    this.name = 'ZohoCreatorApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AppScope {
  accountOwner: string;
  appLinkName: string;
}

export interface FormScope extends AppScope {
  formLinkName: string;
}

export interface ReportScope extends AppScope {
  reportLinkName: string;
}

export interface RecordScope extends ReportScope {
  recordId: string;
}
