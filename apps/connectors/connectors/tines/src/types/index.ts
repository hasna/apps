export interface TinesConfig {
  apiKey: string;
  tenantUrl: string;
}

export interface PaginationParams {
  perPage?: number;
  page?: number;
}

export interface TinesStory {
  id: number;
  name: string;
  description?: string;
  team_id: number;
  folder_id?: number;
  disabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TinesAgent {
  id: number;
  name: string;
  story_id: number;
  type?: string;
  disabled?: boolean;
}

export interface TinesEvent {
  id: number;
  agent_id?: number;
  story_id?: number;
  created_at?: string;
}

export interface TinesFolder {
  id: number;
  name: string;
  team_id: number;
  content_type?: string;
}

export interface TinesTeam {
  id: number;
  name: string;
}

export interface TinesUser {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface TinesTunnel {
  id: number;
  name: string;
}

export interface TinesCredential {
  id: number;
  name: string;
  mode: string;
  team_id: number;
  description?: string;
}

export interface TinesAnnotation {
  id: number;
  story_id: number;
  content?: string;
}

export interface TinesStoryRun {
  id: number;
  story_id: number;
  status: string;
  created_at?: string;
}

export class TinesApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TinesApiError';
    this.statusCode = statusCode;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}
