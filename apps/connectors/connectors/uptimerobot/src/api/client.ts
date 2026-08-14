import type { UptimeRobotConfig } from '../types';
import { UptimeRobotApiError } from '../types';
const DEFAULT_BASE_URL = 'https://api.uptimerobot.com/v2';

// UptimeRobot uses POST for ALL endpoints (unusual)
export class UptimeRobotClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(config: UptimeRobotConfig) {
    if (!config.apiKey) throw new Error('UptimeRobot API key is required');
    this.apiKey = config.apiKey; this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const body = new URLSearchParams();
    body.append('api_key', this.apiKey);
    body.append('format', 'json');
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) body.append(k, String(v)); });
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await response.json().catch(() => ({})) as { stat?: string; error?: { message?: string } };
    if (data.stat === 'fail') throw new UptimeRobotApiError(data.error?.message || 'Request failed', response.status);
    return data as T;
  }
}
