import { PipedriveClient } from './client';
import type {
  PipedriveConfig,
  PipedriveResponse,
  PipedriveListResponse,
  Person,
  CreatePersonInput,
  Organization,
  CreateOrganizationInput,
  Deal,
  CreateDealInput,
  Lead,
  CreateLeadInput,
  Activity,
  CreateActivityInput,
  Pipeline,
  Stage,
  Note,
  CreateNoteInput,
  User,
} from '../types';

export { PipedriveClient } from './client';

export class Pipedrive {
  private client: PipedriveClient;

  constructor(config: PipedriveConfig) {
    this.client = new PipedriveClient(config);
  }

  // ============================================
  // Persons
  // ============================================

  async listPersons(options: { start?: number; limit?: number; sort?: string } = {}): Promise<Person[]> {
    const response = await this.client.get<PipedriveListResponse<Person>>('/persons', {
      start: options.start,
      limit: options.limit || 100,
      sort: options.sort,
    });
    return response.data || [];
  }

  async getPerson(id: number): Promise<Person> {
    const response = await this.client.get<PipedriveResponse<Person>>(`/persons/${id}`);
    return response.data;
  }

  async createPerson(input: CreatePersonInput): Promise<Person> {
    const response = await this.client.post<PipedriveResponse<Person>>('/persons', input);
    return response.data;
  }

  async updatePerson(id: number, input: Partial<CreatePersonInput>): Promise<Person> {
    const response = await this.client.put<PipedriveResponse<Person>>(`/persons/${id}`, input);
    return response.data;
  }

  async deletePerson(id: number): Promise<void> {
    await this.client.delete(`/persons/${id}`);
  }

  async searchPersons(term: string, options: { start?: number; limit?: number } = {}): Promise<Person[]> {
    const response = await this.client.get<PipedriveListResponse<{ item: Person }>>('/persons/search', {
      term,
      start: options.start,
      limit: options.limit || 100,
    });
    return (response.data || []).map(r => r.item);
  }

  // ============================================
  // Organizations
  // ============================================

  async listOrganizations(options: { start?: number; limit?: number; sort?: string } = {}): Promise<Organization[]> {
    const response = await this.client.get<PipedriveListResponse<Organization>>('/organizations', {
      start: options.start,
      limit: options.limit || 100,
      sort: options.sort,
    });
    return response.data || [];
  }

  async getOrganization(id: number): Promise<Organization> {
    const response = await this.client.get<PipedriveResponse<Organization>>(`/organizations/${id}`);
    return response.data;
  }

  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    const response = await this.client.post<PipedriveResponse<Organization>>('/organizations', input);
    return response.data;
  }

  async updateOrganization(id: number, input: Partial<CreateOrganizationInput>): Promise<Organization> {
    const response = await this.client.put<PipedriveResponse<Organization>>(`/organizations/${id}`, input);
    return response.data;
  }

  async deleteOrganization(id: number): Promise<void> {
    await this.client.delete(`/organizations/${id}`);
  }

  async searchOrganizations(term: string, options: { start?: number; limit?: number } = {}): Promise<Organization[]> {
    const response = await this.client.get<PipedriveListResponse<{ item: Organization }>>('/organizations/search', {
      term,
      start: options.start,
      limit: options.limit || 100,
    });
    return (response.data || []).map(r => r.item);
  }

  // ============================================
  // Deals
  // ============================================

  async listDeals(options: { start?: number; limit?: number; status?: string; sort?: string } = {}): Promise<Deal[]> {
    const response = await this.client.get<PipedriveListResponse<Deal>>('/deals', {
      start: options.start,
      limit: options.limit || 100,
      status: options.status,
      sort: options.sort,
    });
    return response.data || [];
  }

  async getDeal(id: number): Promise<Deal> {
    const response = await this.client.get<PipedriveResponse<Deal>>(`/deals/${id}`);
    return response.data;
  }

  async createDeal(input: CreateDealInput): Promise<Deal> {
    const response = await this.client.post<PipedriveResponse<Deal>>('/deals', input);
    return response.data;
  }

  async updateDeal(id: number, input: Partial<CreateDealInput>): Promise<Deal> {
    const response = await this.client.put<PipedriveResponse<Deal>>(`/deals/${id}`, input);
    return response.data;
  }

  async deleteDeal(id: number): Promise<void> {
    await this.client.delete(`/deals/${id}`);
  }

  async searchDeals(term: string, options: { start?: number; limit?: number } = {}): Promise<Deal[]> {
    const response = await this.client.get<PipedriveListResponse<{ item: Deal }>>('/deals/search', {
      term,
      start: options.start,
      limit: options.limit || 100,
    });
    return (response.data || []).map(r => r.item);
  }

  // ============================================
  // Leads
  // ============================================

  async listLeads(options: { start?: number; limit?: number; archived?: boolean } = {}): Promise<Lead[]> {
    const response = await this.client.get<PipedriveListResponse<Lead>>('/leads', {
      start: options.start,
      limit: options.limit || 100,
      archived_status: options.archived ? 'archived' : 'not_archived',
    });
    return response.data || [];
  }

  async getLead(id: string): Promise<Lead> {
    const response = await this.client.get<PipedriveResponse<Lead>>(`/leads/${id}`);
    return response.data;
  }

  async createLead(input: CreateLeadInput): Promise<Lead> {
    const response = await this.client.post<PipedriveResponse<Lead>>('/leads', input);
    return response.data;
  }

  async updateLead(id: string, input: Partial<CreateLeadInput>): Promise<Lead> {
    const response = await this.client.request<PipedriveResponse<Lead>>(`/leads/${id}`, {
      method: 'PATCH',
      body: input as Record<string, unknown>,
    });
    return response.data;
  }

  async deleteLead(id: string): Promise<void> {
    await this.client.delete(`/leads/${id}`);
  }

  // ============================================
  // Activities
  // ============================================

  async listActivities(options: { start?: number; limit?: number; done?: boolean; type?: string } = {}): Promise<Activity[]> {
    const response = await this.client.get<PipedriveListResponse<Activity>>('/activities', {
      start: options.start,
      limit: options.limit || 100,
      done: options.done !== undefined ? (options.done ? 1 : 0) : undefined,
      type: options.type,
    });
    return response.data || [];
  }

  async getActivity(id: number): Promise<Activity> {
    const response = await this.client.get<PipedriveResponse<Activity>>(`/activities/${id}`);
    return response.data;
  }

  async createActivity(input: CreateActivityInput): Promise<Activity> {
    const response = await this.client.post<PipedriveResponse<Activity>>('/activities', input);
    return response.data;
  }

  async updateActivity(id: number, input: Partial<CreateActivityInput>): Promise<Activity> {
    const response = await this.client.put<PipedriveResponse<Activity>>(`/activities/${id}`, input);
    return response.data;
  }

  async deleteActivity(id: number): Promise<void> {
    await this.client.delete(`/activities/${id}`);
  }

  // ============================================
  // Pipelines
  // ============================================

  async listPipelines(): Promise<Pipeline[]> {
    const response = await this.client.get<PipedriveListResponse<Pipeline>>('/pipelines');
    return response.data || [];
  }

  async getPipeline(id: number): Promise<Pipeline> {
    const response = await this.client.get<PipedriveResponse<Pipeline>>(`/pipelines/${id}`);
    return response.data;
  }

  // ============================================
  // Stages
  // ============================================

  async listStages(pipelineId?: number): Promise<Stage[]> {
    const response = await this.client.get<PipedriveListResponse<Stage>>('/stages', {
      pipeline_id: pipelineId,
    });
    return response.data || [];
  }

  async getStage(id: number): Promise<Stage> {
    const response = await this.client.get<PipedriveResponse<Stage>>(`/stages/${id}`);
    return response.data;
  }

  // ============================================
  // Notes
  // ============================================

  async listNotes(options: { start?: number; limit?: number; deal_id?: number; person_id?: number; org_id?: number } = {}): Promise<Note[]> {
    const response = await this.client.get<PipedriveListResponse<Note>>('/notes', {
      start: options.start,
      limit: options.limit || 100,
      deal_id: options.deal_id,
      person_id: options.person_id,
      org_id: options.org_id,
    });
    return response.data || [];
  }

  async getNote(id: number): Promise<Note> {
    const response = await this.client.get<PipedriveResponse<Note>>(`/notes/${id}`);
    return response.data;
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    const response = await this.client.post<PipedriveResponse<Note>>('/notes', input);
    return response.data;
  }

  async updateNote(id: number, input: Partial<CreateNoteInput>): Promise<Note> {
    const response = await this.client.put<PipedriveResponse<Note>>(`/notes/${id}`, input);
    return response.data;
  }

  async deleteNote(id: number): Promise<void> {
    await this.client.delete(`/notes/${id}`);
  }

  // ============================================
  // Users
  // ============================================

  async listUsers(): Promise<User[]> {
    const response = await this.client.get<PipedriveListResponse<User>>('/users');
    return response.data || [];
  }

  async getUser(id: number): Promise<User> {
    const response = await this.client.get<PipedriveResponse<User>>(`/users/${id}`);
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.client.get<PipedriveResponse<User>>('/users/me');
    return response.data;
  }
}
