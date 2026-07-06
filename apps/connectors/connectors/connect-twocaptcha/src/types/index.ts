// 2Captcha API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Task Types
// ============================================

export interface CaptchaTask {
  type: string;
  [key: string]: unknown;
}

export interface CreateTaskParams {
  task: CaptchaTask;
  languagePool?: string;
  callbackUrl?: string;
}

export interface CreateTaskResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: number;
}

export interface GetTaskResultParams {
  taskId: number | string;
}

export type TaskStatus = 'processing' | 'ready';

export interface TaskSolution {
  [key: string]: unknown;
}

export interface TaskResultResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  status?: TaskStatus;
  solution?: TaskSolution;
  cost?: string;
  ip?: string;
  createTime?: number;
  endTime?: number;
  solveCount?: number;
}

export interface BalanceResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  balance?: number;
}

export interface ReportParams {
  taskId: number | string;
}

export interface ReportResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
}

// ============================================
// API Error Types
// ============================================

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errorId?: number;
  public readonly errorCode?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: { errorId?: number; errorCode?: string }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errorId = options?.errorId;
    this.errorCode = options?.errorCode;
  }

  isAuthError(): boolean {
    return this.errorCode === 'ERROR_KEY_DOES_NOT_EXIST'
      || this.errorCode === 'ERROR_WRONG_USER_KEY'
      || this.statusCode === 401
      || this.statusCode === 403;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errorId: this.errorId,
      errorCode: this.errorCode,
    };
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const errorId = typeof data.errorId === 'number' ? data.errorId : undefined;
  const errorCode = data.errorCode ? String(data.errorCode) : undefined;
  const message = data.errorDescription
    ? String(data.errorDescription)
    : data.message
      ? String(data.message)
      : errorCode || `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode, { errorId, errorCode });
}

export function assertApiSuccess<T extends { errorId: number; errorDescription?: string; errorCode?: string }>(
  data: T,
  statusCode: number
): T {
  if (data.errorId !== 0) {
    throw new ConnectorApiError(
      data.errorDescription || data.errorCode || '2Captcha API error',
      statusCode,
      { errorId: data.errorId, errorCode: data.errorCode }
    );
  }
  return data;
}
