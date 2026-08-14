export interface ZohoBiginConfig {
  token: string;
  baseUrl?: string;
}

export interface ZohoBiginRecord {
  id: string;
  [key: string]: unknown;
}

export interface ZohoBiginRecordList {
  data: ZohoBiginRecord[];
  info?: {
    per_page?: number;
    count?: number;
    page?: number;
    more_records?: boolean;
  };
}

export interface ZohoBiginPipeline {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface ZohoBiginTask {
  id: string;
  Subject?: string;
  [key: string]: unknown;
}

export class ZohoBiginApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ZohoBiginApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
