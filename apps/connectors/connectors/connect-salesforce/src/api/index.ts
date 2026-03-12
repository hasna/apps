// Salesforce Connector
// CRM accounts, contacts, leads, and opportunities

import { SalesforceClient } from './client';
import type {
  SalesforceConfig,
  SalesforceQueryResponse,
  CreateResponse,
  Account,
  CreateAccountInput,
  Contact,
  CreateContactInput,
  Lead,
  CreateLeadInput,
  Opportunity,
  CreateOpportunityInput,
  Task,
  CreateTaskInput,
  User,
} from '../types';

export { SalesforceClient } from './client';

export class Salesforce {
  private client: SalesforceClient;

  constructor(config: SalesforceConfig) {
    this.client = new SalesforceClient(config);
  }

  // ============================================
  // SOQL Query
  // ============================================

  /**
   * Execute a SOQL query
   */
  async query<T>(soql: string): Promise<SalesforceQueryResponse<T>> {
    return this.client.get('/query', { q: soql });
  }

  /**
   * Get next page of query results
   */
  async queryMore<T>(nextRecordsUrl: string): Promise<SalesforceQueryResponse<T>> {
    // nextRecordsUrl is a full path like /services/data/v59.0/query/xxx
    const path = nextRecordsUrl.replace(/^\/services\/data\/v\d+\.\d+/, '');
    return this.client.get(path);
  }

  // ============================================
  // Accounts
  // ============================================

  /**
   * List accounts
   */
  async listAccounts(params?: {
    limit?: number;
    fields?: string[];
  }): Promise<SalesforceQueryResponse<Account>> {
    const fields = params?.fields?.join(', ') || 'Id, Name, Type, Industry, Website, Phone, CreatedDate';
    const limit = params?.limit || 100;
    return this.query<Account>(`SELECT ${fields} FROM Account ORDER BY CreatedDate DESC LIMIT ${limit}`);
  }

  /**
   * Get an account by ID
   */
  async getAccount(accountId: string): Promise<Account> {
    return this.client.get(`/sobjects/Account/${accountId}`);
  }

  /**
   * Create an account
   */
  async createAccount(data: CreateAccountInput): Promise<CreateResponse> {
    return this.client.post('/sobjects/Account', data);
  }

  /**
   * Update an account
   */
  async updateAccount(accountId: string, data: Partial<CreateAccountInput>): Promise<void> {
    await this.client.patch(`/sobjects/Account/${accountId}`, data);
  }

  /**
   * Delete an account
   */
  async deleteAccount(accountId: string): Promise<void> {
    await this.client.delete(`/sobjects/Account/${accountId}`);
  }

  // ============================================
  // Contacts
  // ============================================

  /**
   * List contacts
   */
  async listContacts(params?: {
    limit?: number;
    accountId?: string;
    fields?: string[];
  }): Promise<SalesforceQueryResponse<Contact>> {
    const fields = params?.fields?.join(', ') || 'Id, FirstName, LastName, Email, Phone, AccountId, CreatedDate';
    const limit = params?.limit || 100;
    let query = `SELECT ${fields} FROM Contact`;
    if (params?.accountId) {
      query += ` WHERE AccountId = '${params.accountId}'`;
    }
    query += ` ORDER BY CreatedDate DESC LIMIT ${limit}`;
    return this.query<Contact>(query);
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string): Promise<Contact> {
    return this.client.get(`/sobjects/Contact/${contactId}`);
  }

  /**
   * Create a contact
   */
  async createContact(data: CreateContactInput): Promise<CreateResponse> {
    return this.client.post('/sobjects/Contact', data);
  }

  /**
   * Update a contact
   */
  async updateContact(contactId: string, data: Partial<CreateContactInput>): Promise<void> {
    await this.client.patch(`/sobjects/Contact/${contactId}`, data);
  }

  /**
   * Delete a contact
   */
  async deleteContact(contactId: string): Promise<void> {
    await this.client.delete(`/sobjects/Contact/${contactId}`);
  }

  // ============================================
  // Leads
  // ============================================

  /**
   * List leads
   */
  async listLeads(params?: {
    limit?: number;
    status?: string;
    fields?: string[];
  }): Promise<SalesforceQueryResponse<Lead>> {
    const fields = params?.fields?.join(', ') || 'Id, FirstName, LastName, Company, Email, Phone, Status, CreatedDate';
    const limit = params?.limit || 100;
    let query = `SELECT ${fields} FROM Lead`;
    if (params?.status) {
      query += ` WHERE Status = '${params.status}'`;
    }
    query += ` ORDER BY CreatedDate DESC LIMIT ${limit}`;
    return this.query<Lead>(query);
  }

  /**
   * Get a lead by ID
   */
  async getLead(leadId: string): Promise<Lead> {
    return this.client.get(`/sobjects/Lead/${leadId}`);
  }

  /**
   * Create a lead
   */
  async createLead(data: CreateLeadInput): Promise<CreateResponse> {
    return this.client.post('/sobjects/Lead', data);
  }

  /**
   * Update a lead
   */
  async updateLead(leadId: string, data: Partial<CreateLeadInput>): Promise<void> {
    await this.client.patch(`/sobjects/Lead/${leadId}`, data);
  }

  /**
   * Delete a lead
   */
  async deleteLead(leadId: string): Promise<void> {
    await this.client.delete(`/sobjects/Lead/${leadId}`);
  }

  // ============================================
  // Opportunities
  // ============================================

  /**
   * List opportunities
   */
  async listOpportunities(params?: {
    limit?: number;
    accountId?: string;
    stageName?: string;
    fields?: string[];
  }): Promise<SalesforceQueryResponse<Opportunity>> {
    const fields = params?.fields?.join(', ') || 'Id, Name, AccountId, StageName, Amount, CloseDate, CreatedDate';
    const limit = params?.limit || 100;
    let query = `SELECT ${fields} FROM Opportunity`;
    const conditions: string[] = [];
    if (params?.accountId) {
      conditions.push(`AccountId = '${params.accountId}'`);
    }
    if (params?.stageName) {
      conditions.push(`StageName = '${params.stageName}'`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY CreatedDate DESC LIMIT ${limit}`;
    return this.query<Opportunity>(query);
  }

  /**
   * Get an opportunity by ID
   */
  async getOpportunity(opportunityId: string): Promise<Opportunity> {
    return this.client.get(`/sobjects/Opportunity/${opportunityId}`);
  }

  /**
   * Create an opportunity
   */
  async createOpportunity(data: CreateOpportunityInput): Promise<CreateResponse> {
    return this.client.post('/sobjects/Opportunity', data);
  }

  /**
   * Update an opportunity
   */
  async updateOpportunity(opportunityId: string, data: Partial<CreateOpportunityInput>): Promise<void> {
    await this.client.patch(`/sobjects/Opportunity/${opportunityId}`, data);
  }

  /**
   * Delete an opportunity
   */
  async deleteOpportunity(opportunityId: string): Promise<void> {
    await this.client.delete(`/sobjects/Opportunity/${opportunityId}`);
  }

  // ============================================
  // Tasks
  // ============================================

  /**
   * List tasks
   */
  async listTasks(params?: {
    limit?: number;
    whoId?: string;
    whatId?: string;
    fields?: string[];
  }): Promise<SalesforceQueryResponse<Task>> {
    const fields = params?.fields?.join(', ') || 'Id, Subject, Status, Priority, ActivityDate, WhoId, WhatId, CreatedDate';
    const limit = params?.limit || 100;
    let query = `SELECT ${fields} FROM Task`;
    const conditions: string[] = [];
    if (params?.whoId) {
      conditions.push(`WhoId = '${params.whoId}'`);
    }
    if (params?.whatId) {
      conditions.push(`WhatId = '${params.whatId}'`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY CreatedDate DESC LIMIT ${limit}`;
    return this.query<Task>(query);
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<Task> {
    return this.client.get(`/sobjects/Task/${taskId}`);
  }

  /**
   * Create a task
   */
  async createTask(data: CreateTaskInput): Promise<CreateResponse> {
    return this.client.post('/sobjects/Task', data);
  }

  /**
   * Update a task
   */
  async updateTask(taskId: string, data: Partial<CreateTaskInput>): Promise<void> {
    await this.client.patch(`/sobjects/Task/${taskId}`, data);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.client.delete(`/sobjects/Task/${taskId}`);
  }

  // ============================================
  // Users
  // ============================================

  /**
   * List users
   */
  async listUsers(params?: {
    limit?: number;
    isActive?: boolean;
    fields?: string[];
  }): Promise<SalesforceQueryResponse<User>> {
    const fields = params?.fields?.join(', ') || 'Id, Username, Name, Email, IsActive, CreatedDate';
    const limit = params?.limit || 100;
    let query = `SELECT ${fields} FROM User`;
    if (params?.isActive !== undefined) {
      query += ` WHERE IsActive = ${params.isActive}`;
    }
    query += ` LIMIT ${limit}`;
    return this.query<User>(query);
  }

  /**
   * Get a user by ID
   */
  async getUser(userId: string): Promise<User> {
    return this.client.get(`/sobjects/User/${userId}`);
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<{ identity: string; user_id: string; organization_id: string; username: string; display_name: string }> {
    // Use the identity endpoint
    const url = new URL(this.client.getInstanceUrl());
    const response = await fetch(`${url.origin}/services/oauth2/userinfo`, {
      headers: {
        'Authorization': `Bearer ${this.client['accessToken']}`,
      },
    });
    return response.json();
  }

  /**
   * Get access token preview for debugging
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get instance URL
   */
  getInstanceUrl(): string {
    return this.client.getInstanceUrl();
  }
}
