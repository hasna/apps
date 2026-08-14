export interface TextItConfig {
  apiToken: string;
  baseUrl?: string;
  tokenPrefix?: string;
}

export interface TextItContact {
  uuid: string;
  name?: string;
  language?: string;
  urns?: string[];
  groups?: Array<{ uuid: string; name: string }>;
  fields?: Record<string, unknown>;
  blocked?: boolean;
  stopped?: boolean;
  created_on?: string;
  modified_on?: string;
}

export interface TextItMessage {
  id: number;
  uuid: string;
  text: string;
  urn?: string;
  direction: "in" | "out";
  status?: string;
  channel?: { uuid: string; name: string };
  contact?: { uuid: string; name: string };
  created_on?: string;
}

export interface TextItFlow {
  uuid: string;
  name: string;
  expires?: number;
  archived?: boolean;
  labels?: string[];
  created_on?: string;
  modified_on?: string;
}

export interface TextItFlowStart {
  uuid: string;
  flow: { uuid: string; name: string };
  contact: { uuid: string; name: string };
  restart_participants?: boolean;
  status?: string;
  created_on?: string;
}

export interface TextItListResponse<T> {
  next?: string | null;
  previous?: string | null;
  results: T[];
}

export class TextItApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "TextItApiError";
    this.statusCode = statusCode;
  }
}
