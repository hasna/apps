export interface ApiaryConfig { token: string; }

export interface ApiaryApi { id: string; name: string; description: string; subdomain: string; public: boolean; team_id: string; created_at: string; updated_at: string; }
export interface ApiaryApiList { apis: ApiaryApi[]; }
export interface ApiaryBlueprint { code: string; name: string; metadata: { format: string; version: string }; }
export interface ApiaryTest { id: string; api_id: string; status: string; passed: number; failed: number; errors: number; created_at: string; }
export interface ApiaryTestList { tests: ApiaryTest[]; }
export interface ApiaryTeam { id: string; name: string; description: string; members: { id: string; email: string; role: string }[]; }

export class ApiaryApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ApiaryApiError'; this.statusCode = statusCode; }
}
