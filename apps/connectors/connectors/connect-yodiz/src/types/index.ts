export interface YodizConfig { apiKey: string; apiToken: string; }

export interface YZProject { id: number; title: string; description: string; status: string; start_date: string; end_date: string; owner: { id: number; name: string }; created_date: string; }
export interface YZUserStory { id: number; title: string; description: string; status: { id: number; title: string }; priority: { id: number; title: string }; project: { id: number; title: string }; sprint: { id: number; title: string } | null; assigned_to: { id: number; name: string } | null; story_points: number; created_date: string; }
export interface YZIssue { id: number; title: string; description: string; status: { id: number; title: string }; priority: { id: number; title: string }; type: { id: number; title: string }; project: { id: number; title: string }; assigned_to: { id: number; name: string } | null; created_date: string; }
export interface YZSprint { id: number; title: string; status: string; start_date: string; end_date: string; project: { id: number; title: string }; }
export interface YZComment { id: number; text: string; author: { id: number; name: string }; created_date: string; }

export class YodizApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'YodizApiError'; this.statusCode = statusCode; }
}
