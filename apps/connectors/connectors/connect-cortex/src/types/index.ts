export interface CortexConfig { token: string; }

export interface CortexService { tag: string; name: string; description: string; type: string; owners: { name: string; email: string }[]; groups: string[]; links: { name: string; url: string }[]; }
export interface CortexServiceList { services: CortexService[]; total: number; page: number; }
export interface CortexScorecard { tag: string; name: string; description: string; rules: CortexRule[]; }
export interface CortexRule { title: string; expression: string; weight: number; description: string; }
export interface CortexScore { service_tag: string; scorecard_tag: string; score: number; total_rules: number; passing_rules: number; evaluated_at: string; }
export interface CortexTeam { tag: string; name: string; description: string; members: { name: string; email: string; role: string }[]; }
export interface CortexCatalogEntity { tag: string; type: string; name: string; description: string; owners: { name: string; email: string }[]; }

export class CortexApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CortexApiError'; this.statusCode = statusCode; }
}
