export const USERFLOW_API_VERSION = '2024-12-12';

export interface UserflowConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type EntityType = 'user' | 'group';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface CursorListParams extends QueryParams {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface UserflowApiErrorBody {
  message?: string;
  error?: string;
}

export class UserflowApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UserflowApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseUserflowError(data: unknown, status: number): UserflowApiError {
  let message = `Userflow: HTTP ${status}`;

  if (typeof data === 'object' && data !== null) {
    const body = data as UserflowApiErrorBody;
    if (typeof body.message === 'string' && body.message.length > 0) {
      message = `Userflow: ${body.message}`;
    } else if (typeof body.error === 'string' && body.error.length > 0) {
      message = `Userflow: ${body.error}`;
    }
  } else if (typeof data === 'string' && data.length > 0) {
    message = `Userflow: ${data}`;
  }

  return new UserflowApiError(message, status);
}
