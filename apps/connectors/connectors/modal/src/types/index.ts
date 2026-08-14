// Modal API Types

export interface ModalConfig {
  tokenId: string;
  tokenSecret: string;
  baseUrl?: string;
}

// Web Endpoint Types
export interface WebEndpointRequest {
  [key: string]: unknown;
}

export interface WebEndpointResponse {
  [key: string]: unknown;
}

// App Types
export interface ModalApp {
  app_id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at?: string;
}

export interface AppsListResponse {
  apps: ModalApp[];
}

// Function Types
export interface ModalFunction {
  function_id: string;
  name: string;
  app_id: string;
  created_at: string;
}

// Secret Types
export interface ModalSecret {
  name: string;
  created_at: string;
  updated_at?: string;
}

export interface SecretsListResponse {
  secrets: ModalSecret[];
}

// Error Types
export class ModalApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'ModalApiError';
  }
}
