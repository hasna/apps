export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type FeedbackKind = "bug" | "idea" | "question" | "praise" | "other";
export type FeedbackSeverity = "low" | "medium" | "high" | "critical";
export type FeedbackStatus = "new" | "triaged" | "closed";
export type FeedbackSource = "api" | "cli" | "sdk" | "mcp" | "server";

export interface FeedbackContext {
  route?: string;
  screen?: string;
  url?: string;
  version?: string;
  commit?: string;
  environment?: string;
  userAgent?: string;
  sessionId?: string;
  locale?: string;
  viewport?: string;
  [key: string]: JsonValue | undefined;
}

export interface FeedbackInput {
  appId: string;
  message: string;
  kind?: FeedbackKind;
  severity?: FeedbackSeverity;
  userId?: string;
  email?: string;
  url?: string;
  rating?: number;
  tags?: string[];
  metadata?: JsonObject;
  context?: FeedbackContext;
}

export interface FeedbackItem extends FeedbackInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: FeedbackStatus;
  source: FeedbackSource;
  kind: FeedbackKind;
  tags: string[];
}

export interface FeedbackListFilter {
  appId?: string;
  status?: FeedbackStatus;
  tag?: string;
  limit?: number;
}

export interface FeedbackStats {
  total: number;
  byApp: Record<string, number>;
  byKind: Record<FeedbackKind, number>;
  byStatus: Record<FeedbackStatus, number>;
  bySeverity: Partial<Record<FeedbackSeverity, number>>;
}

export interface FeedbackCreateOptions {
  source?: FeedbackSource;
  now?: Date;
}

export interface FeedbackStore {
  createFeedback(input: FeedbackInput, options?: FeedbackCreateOptions): Promise<FeedbackItem>;
  listFeedback(filter?: FeedbackListFilter): Promise<FeedbackItem[]>;
  getFeedback(id: string): Promise<FeedbackItem | null>;
  updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem | null>;
  stats(): Promise<FeedbackStats>;
  exportJsonl(filter?: FeedbackListFilter): Promise<string>;
}

