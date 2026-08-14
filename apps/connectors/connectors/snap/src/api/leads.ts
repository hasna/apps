import type { SnapClient } from './client';
import type {
  LeadForm,
  LeadFormField,
  LeadFormCreateParams,
  LeadFormUpdateParams,
  LeadFormResponse,
  Lead,
  LeadResponse,
} from '../types';

/**
 * Snapchat Leads API
 * Manage lead generation forms and retrieve leads
 */
export class LeadsApi {
  constructor(private readonly client: SnapClient) {}

  // ============================================
  // Lead Form Operations
  // ============================================

  /**
   * List all lead forms for an ad account
   */
  async listForms(adAccountId: string): Promise<LeadForm[]> {
    const response = await this.client.get<LeadFormResponse>(
      `/adaccounts/${adAccountId}/lead_forms`
    );
    return response.lead_forms?.map(f => f.lead_form) || [];
  }

  /**
   * Get a specific lead form by ID
   */
  async getForm(leadFormId: string): Promise<LeadForm> {
    const response = await this.client.get<LeadFormResponse>(`/lead_forms/${leadFormId}`);
    const form = response.lead_forms?.[0]?.lead_form;
    if (!form) {
      throw new Error(`Lead form ${leadFormId} not found`);
    }
    return form;
  }

  /**
   * Create a new lead form
   */
  async createForm(params: LeadFormCreateParams): Promise<LeadForm> {
    const response = await this.client.post<LeadFormResponse>(
      `/adaccounts/${params.ad_account_id}/lead_forms`,
      {
        lead_forms: [params],
      }
    );
    const form = response.lead_forms?.[0]?.lead_form;
    if (!form) {
      throw new Error('Failed to create lead form');
    }
    return form;
  }

  /**
   * Update a lead form
   */
  async updateForm(leadFormId: string, params: LeadFormUpdateParams): Promise<LeadForm> {
    const response = await this.client.put<LeadFormResponse>(
      `/lead_forms/${leadFormId}`,
      {
        lead_forms: [{ id: leadFormId, ...params }],
      }
    );
    const form = response.lead_forms?.[0]?.lead_form;
    if (!form) {
      throw new Error('Failed to update lead form');
    }
    return form;
  }

  /**
   * Delete a lead form
   */
  async deleteForm(leadFormId: string): Promise<void> {
    await this.client.delete(`/lead_forms/${leadFormId}`);
  }

  /**
   * Archive a lead form
   */
  async archiveForm(leadFormId: string): Promise<LeadForm> {
    return this.updateForm(leadFormId, { status: 'ARCHIVED' });
  }

  /**
   * Pause a lead form
   */
  async pauseForm(leadFormId: string): Promise<LeadForm> {
    return this.updateForm(leadFormId, { status: 'PAUSED' });
  }

  /**
   * Activate a lead form
   */
  async activateForm(leadFormId: string): Promise<LeadForm> {
    return this.updateForm(leadFormId, { status: 'ACTIVE' });
  }

  // ============================================
  // Lead Operations
  // ============================================

  /**
   * List all leads for a lead form
   */
  async listLeads(leadFormId: string, options?: {
    limit?: number;
    offset?: number;
    startTime?: string;
    endTime?: string;
  }): Promise<Lead[]> {
    const response = await this.client.get<LeadResponse>(
      `/lead_forms/${leadFormId}/leads`,
      {
        limit: options?.limit,
        offset: options?.offset,
        start_time: options?.startTime,
        end_time: options?.endTime,
      }
    );
    return response.leads?.map(l => l.lead) || [];
  }

  /**
   * Get a specific lead by ID
   */
  async getLead(leadId: string): Promise<Lead> {
    const response = await this.client.get<LeadResponse>(`/leads/${leadId}`);
    const lead = response.leads?.[0]?.lead;
    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }
    return lead;
  }

  /**
   * List leads for an ad account across all forms
   */
  async listLeadsByAccount(adAccountId: string, options?: {
    limit?: number;
    startTime?: string;
    endTime?: string;
  }): Promise<Lead[]> {
    const response = await this.client.get<LeadResponse>(
      `/adaccounts/${adAccountId}/leads`,
      {
        limit: options?.limit,
        start_time: options?.startTime,
        end_time: options?.endTime,
      }
    );
    return response.leads?.map(l => l.lead) || [];
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Create a basic contact info lead form
   */
  async createBasicContactForm(
    adAccountId: string,
    name: string,
    privacyPolicyUrl: string,
    options?: {
      headline?: string;
      description?: string;
      includePhone?: boolean;
      thankYouMessage?: string;
      webhookUrl?: string;
    }
  ): Promise<LeadForm> {
    const fields: LeadFormField[] = [
      { type: 'FULL_NAME', required: true },
      { type: 'EMAIL', required: true },
    ];

    if (options?.includePhone) {
      fields.push({ type: 'PHONE_NUMBER', required: false });
    }

    return this.createForm({
      name,
      ad_account_id: adAccountId,
      privacy_policy_url: privacyPolicyUrl,
      headline: options?.headline,
      description: options?.description,
      fields,
      thank_you_headline: options?.thankYouMessage || 'Thank you!',
      thank_you_description: 'We will be in touch soon.',
      leads_webhook_url: options?.webhookUrl,
    });
  }

  /**
   * Create a detailed lead form with custom fields
   */
  async createDetailedForm(
    adAccountId: string,
    name: string,
    privacyPolicyUrl: string,
    fieldTypes: ('FULL_NAME' | 'FIRST_NAME' | 'LAST_NAME' | 'EMAIL' | 'PHONE_NUMBER' |
      'STREET_ADDRESS' | 'CITY' | 'STATE' | 'ZIP_CODE' | 'COUNTRY' | 'DATE_OF_BIRTH' |
      'GENDER' | 'COMPANY_NAME' | 'JOB_TITLE' | 'WORK_EMAIL' | 'WORK_PHONE_NUMBER')[],
    options?: {
      headline?: string;
      description?: string;
      thankYouHeadline?: string;
      thankYouDescription?: string;
      thankYouUrl?: string;
      webhookUrl?: string;
    }
  ): Promise<LeadForm> {
    const fields = fieldTypes.map(type => ({
      type,
      required: type === 'EMAIL' || type === 'FULL_NAME',
    }));

    return this.createForm({
      name,
      ad_account_id: adAccountId,
      privacy_policy_url: privacyPolicyUrl,
      headline: options?.headline,
      description: options?.description,
      fields,
      thank_you_headline: options?.thankYouHeadline,
      thank_you_description: options?.thankYouDescription,
      thank_you_url: options?.thankYouUrl,
      leads_webhook_url: options?.webhookUrl,
    });
  }

  /**
   * Export leads to CSV format
   */
  exportLeadsToCSV(leads: Lead[]): string {
    if (leads.length === 0) {
      return '';
    }

    // Get all unique field types
    const fieldTypes = new Set<string>();
    for (const lead of leads) {
      for (const response of lead.responses) {
        fieldTypes.add(response.field_type);
      }
    }

    const headers = ['lead_id', 'created_at', ...Array.from(fieldTypes)];
    const rows = leads.map(lead => {
      const row: Record<string, string> = {
        lead_id: lead.id,
        created_at: lead.created_at,
      };

      for (const response of lead.responses) {
        row[response.field_type] = response.response;
      }

      return headers.map(h => row[h] || '');
    });

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Get available field types for lead forms
   */
  getAvailableFieldTypes(): string[] {
    return [
      'FULL_NAME',
      'FIRST_NAME',
      'LAST_NAME',
      'EMAIL',
      'PHONE_NUMBER',
      'STREET_ADDRESS',
      'CITY',
      'STATE',
      'ZIP_CODE',
      'COUNTRY',
      'DATE_OF_BIRTH',
      'GENDER',
      'COMPANY_NAME',
      'JOB_TITLE',
      'WORK_EMAIL',
      'WORK_PHONE_NUMBER',
      'CUSTOM',
    ];
  }
}
