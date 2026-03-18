export interface FusiooConfig {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
}

export interface App {
  id: string;
  name: string;
  description: string | null;
  fields: Field[];
  recordCount: number;
  created: string;
  updated: string;
}

export interface Field {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiSelect' | 'user' | 'file' | 'url' | 'email' | 'phone';
  required: boolean;
  options?: string[];
}

export interface AppRecord {
  id: string;
  appId: string;
  fields: Record<string, unknown>;
  created: string;
  updated: string;
  createdBy: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'guest';
  status: 'active' | 'inactive';
}

export class FusiooApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'FusiooApiError';
    this.statusCode = statusCode;
  }
}
