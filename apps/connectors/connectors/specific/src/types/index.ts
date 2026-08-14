// Specific Connector Types
// Specific (specific.app) is an AI conversational-survey / user-research platform.
// The public API is a GraphQL endpoint: https://public-api.specific.app/graphql

// ============================================
// Configuration
// ============================================

export interface SpecificConfig {
  apiKey: string;   // Personal API key (sent raw in the Authorization header)
  baseUrl?: string; // Override the GraphQL endpoint
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// GraphQL Transport Types
// ============================================

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

export interface GraphQLErrorLocation {
  line: number;
  column: number;
}

export interface GraphQLError {
  message: string;
  path?: (string | number)[];
  locations?: GraphQLErrorLocation[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

// ============================================
// Resource Types
// ============================================

export interface Workspace {
  id: string;
  name?: string;
  slug?: string;
}

export interface Survey {
  id: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Conversation {
  id: string;
  surveyId?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Company {
  id: string;
  name?: string;
  domain?: string;
  createdAt?: string;
}

export interface User {
  id: string;
  email?: string;
  name?: string;
  createdAt?: string;
}

// ============================================
// Mutation Input Types
// ============================================

export interface CompanyInput {
  id?: string;
  name?: string;
  domain?: string;
  attributes?: Record<string, unknown>;
}

export interface UserInput {
  id?: string;
  email?: string;
  name?: string;
  attributes?: Record<string, unknown>;
}

export interface WebhookSubscription {
  id: string;
  url?: string;
  event?: string;
}

// ============================================
// API Error Types
// ============================================

export class SpecificApiError extends Error {
  public readonly statusCode?: number;
  public readonly errors?: GraphQLError[];

  constructor(message: string, statusCode?: number, errors?: GraphQLError[]) {
    super(message);
    this.name = 'SpecificApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
