export interface ProfitWellConfig { apiKey: string; }

export interface PWMetrics { date: string; active_customers: number; mrr: number; arr: number; arpu: number; ltv: number; churn_rate: number; new_customers: number; churned_customers: number; upgrades: number; downgrades: number; }
export interface PWSubscription { id: string; email: string; plan_id: string; plan_interval: string; status: string; value: number; effective_date: string; }
export interface PWPlan { id: string; name: string; value: number; interval: string; }
export interface PWChurnDetail { email: string; plan_id: string; value: number; churned_date: string; reason: string; }

export class ProfitWellApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ProfitWellApiError'; this.statusCode = statusCode; }
}
