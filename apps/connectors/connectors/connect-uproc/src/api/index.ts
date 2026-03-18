// uProc Connector — Data processing and enrichment tools
import { UProcClient } from './client';
import type { UProcConfig, UProcToolResult, UProcTool } from '../types';
export { UProcClient } from './client';

export class UProc {
  private readonly client: UProcClient;
  constructor(config: UProcConfig) { this.client = new UProcClient(config); }

  static fromEnv(): UProc {
    const email = process.env.UPROC_EMAIL;
    const apiKey = process.env.UPROC_API_KEY;
    if (!email || !apiKey) throw new Error('UPROC_EMAIL and UPROC_API_KEY are required');
    return new UProc({ email, apiKey });
  }

  /** Execute a uProc tool with input data */
  async executeTool(toolId: string, inputs: Record<string, string | number | boolean>): Promise<UProcToolResult> {
    return this.client.request<UProcToolResult>('/process', { tool: toolId, ...inputs });
  }

  /** Validate an email address */
  async validateEmail(email: string): Promise<UProcToolResult> {
    return this.executeTool('get-email-validation', { email });
  }

  /** Normalize a phone number */
  async normalizePhone(phone: string, countryCode?: string): Promise<UProcToolResult> {
    return this.executeTool('get-phone-number-info', { phone, country_code: countryCode ?? 'US' });
  }

  /** Get company info from domain */
  async getCompanyFromDomain(domain: string): Promise<UProcToolResult> {
    return this.executeTool('get-company-from-domain', { domain });
  }

  /** Find professional email for a person */
  async findEmail(firstName: string, lastName: string, domain: string): Promise<UProcToolResult> {
    return this.executeTool('get-email-from-name-and-domain', { first_name: firstName, last_name: lastName, domain });
  }

  /** List all available tools */
  async listTools(): Promise<UProcTool[]> {
    const r = await this.client.request<{ tools: UProcTool[] }>('/tools');
    return r.tools ?? [];
  }

  getClient(): UProcClient { return this.client; }
}
