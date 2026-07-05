// Zoho Creator Connector — Low-code business apps and databases
import { ZohoCreatorClient, appBase, requireString } from './client';
import type {
  ZohoCreatorConfig,
  FieldConfig,
  SkipWorkflow,
  ZohoCreatorApiResponse,
} from '../types';

export { ZohoCreatorClient, DC_BASES, VALID_DATA_CENTERS, VALID_ENVIRONMENTS, appBase, requireString } from './client';

export class ZohoCreator {
  private readonly client: ZohoCreatorClient;

  constructor(config: ZohoCreatorConfig) {
    this.client = new ZohoCreatorClient(config);
  }

  static fromEnv(): ZohoCreator {
    const accessToken = process.env.ZOHOCREATOR_ACCESS_TOKEN;
    if (!accessToken) throw new Error('ZOHOCREATOR_ACCESS_TOKEN is required');
    return new ZohoCreator({
      accessToken,
      dataCenter: process.env.ZOHOCREATOR_DATA_CENTER as ZohoCreatorConfig['dataCenter'],
      environment: process.env.ZOHOCREATOR_ENVIRONMENT as ZohoCreatorConfig['environment'],
    });
  }

  async listApplications(): Promise<ZohoCreatorApiResponse> {
    return this.client.get('/applications');
  }

  async getApplication(accountOwner: string, appLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(appBase(accountOwner, appLinkName));
  }

  async listForms(accountOwner: string, appLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(`${appBase(accountOwner, appLinkName)}/forms`);
  }

  async getFormMetadata(accountOwner: string, appLinkName: string, formLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/form/${encodeURIComponent(requireString(formLinkName, 'formLinkName'))}/meta`,
    );
  }

  async listReports(accountOwner: string, appLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(`${appBase(accountOwner, appLinkName)}/reports`);
  }

  async getReportRecords(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    options?: { criteria?: string; from?: number; max_records?: number; field_config?: FieldConfig },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}`,
      options,
    );
  }

  async getRecord(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    recordId: string,
    options?: { field_config?: FieldConfig },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/${encodeURIComponent(requireString(recordId, 'recordId'))}`,
      options,
    );
  }

  async getRecordCount(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    options?: { criteria?: string },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/record-count`,
      options,
    );
  }

  async addRecord(
    accountOwner: string,
    appLinkName: string,
    formLinkName: string,
    data: Record<string, unknown>,
    options?: {
      result?: { fields?: string[]; message?: boolean; tasks?: boolean };
      skip_workflow?: SkipWorkflow[];
    },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.post(
      `${appBase(accountOwner, appLinkName)}/form/${encodeURIComponent(requireString(formLinkName, 'formLinkName'))}`,
      { data, result: options?.result, skip_workflow: options?.skip_workflow },
    );
  }

  async addRecordsBulk(
    accountOwner: string,
    appLinkName: string,
    formLinkName: string,
    data: Array<Record<string, unknown>>,
    options?: {
      result?: { fields?: string[]; message?: boolean; tasks?: boolean };
      skip_workflow?: SkipWorkflow[];
    },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.post(
      `${appBase(accountOwner, appLinkName)}/form/${encodeURIComponent(requireString(formLinkName, 'formLinkName'))}`,
      { data, result: options?.result, skip_workflow: options?.skip_workflow },
    );
  }

  async updateRecord(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    recordId: string,
    data: Record<string, unknown>,
    options?: { result?: Record<string, unknown> },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.patch(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/${encodeURIComponent(requireString(recordId, 'recordId'))}`,
      { data, result: options?.result },
    );
  }

  async updateRecordsByCriteria(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    criteria: string,
    data: Record<string, unknown>,
    options?: { result?: Record<string, unknown> },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.patch(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}`,
      { criteria: requireString(criteria, 'criteria'), data, result: options?.result },
    );
  }

  async deleteRecord(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    recordId: string,
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.delete(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/${encodeURIComponent(requireString(recordId, 'recordId'))}`,
    );
  }

  async deleteRecordsByCriteria(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    criteria: string,
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.delete(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}`,
      { criteria: requireString(criteria, 'criteria') },
    );
  }

  async runCustomAction(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    recordId: string,
    actionLinkName: string,
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.post(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/${encodeURIComponent(requireString(recordId, 'recordId'))}/actions/${encodeURIComponent(requireString(actionLinkName, 'actionLinkName'))}`,
    );
  }

  async runCustomBulkAction(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    criteria: string,
    actionLinkName: string,
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.post(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/actions/${encodeURIComponent(requireString(actionLinkName, 'actionLinkName'))}`,
      { criteria: requireString(criteria, 'criteria') },
    );
  }

  async invokeFunction(
    accountOwner: string,
    appLinkName: string,
    functionLinkName: string,
    options?: { payload?: Record<string, unknown>; publicKey?: string },
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.post(
      `${appBase(accountOwner, appLinkName)}/functions/${encodeURIComponent(requireString(functionLinkName, 'functionLinkName'))}`,
      { payload: options?.payload },
      options?.publicKey ? { publickey: options.publicKey } : undefined,
    );
  }

  async listPages(accountOwner: string, appLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(`${appBase(accountOwner, appLinkName)}/pages`);
  }

  async getPageMeta(accountOwner: string, appLinkName: string, pageLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/pages/${encodeURIComponent(requireString(pageLinkName, 'pageLinkName'))}/meta`,
    );
  }

  async listFields(accountOwner: string, appLinkName: string, reportLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/fields`,
    );
  }

  async listSections(accountOwner: string, appLinkName: string, reportLinkName: string): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/sections`,
    );
  }

  async listOrgUsers(): Promise<ZohoCreatorApiResponse> {
    return this.client.get('/users');
  }

  async listFileFields(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    recordId: string,
    fieldLinkName: string,
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/${encodeURIComponent(requireString(recordId, 'recordId'))}/${encodeURIComponent(requireString(fieldLinkName, 'fieldLinkName'))}/download`,
    );
  }

  async listLinkedRecords(
    accountOwner: string,
    appLinkName: string,
    reportLinkName: string,
    recordId: string,
    subformLinkName: string,
  ): Promise<ZohoCreatorApiResponse> {
    return this.client.get(
      `${appBase(accountOwner, appLinkName)}/report/${encodeURIComponent(requireString(reportLinkName, 'reportLinkName'))}/${encodeURIComponent(requireString(recordId, 'recordId'))}/${encodeURIComponent(requireString(subformLinkName, 'subformLinkName'))}`,
    );
  }

  getClient(): ZohoCreatorClient {
    return this.client;
  }
}
