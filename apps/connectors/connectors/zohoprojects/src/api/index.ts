// Zoho Projects Connector — Project management, tasks, milestones, and time tracking
import { ZohoProjectsClient } from './client';
import type { ZohoProjectsConfig } from '../types';

export { ZohoProjectsClient, DC_BASES, resolveBaseUrl } from './client';
export type { ZohoProjectsRequestOptions } from './client';

export class ZohoProjects {
  private readonly client: ZohoProjectsClient;

  constructor(config: ZohoProjectsConfig) {
    this.client = new ZohoProjectsClient(config);
  }

  static fromEnv(): ZohoProjects {
    const token = process.env.ZOHOPROJECTS_TOKEN;
    if (!token) throw new Error('ZOHOPROJECTS_TOKEN is required');
    return new ZohoProjects({
      token,
      portalId: process.env.ZOHOPROJECTS_PORTAL_ID,
      dataCenter: process.env.ZOHOPROJECTS_DATA_CENTER,
      baseUrl: process.env.ZOHOPROJECTS_BASE_URL,
    });
  }

  async listPortals(): Promise<unknown> {
    return this.client.request('/portals/');
  }

  async listProjects(
    portalId?: string,
    options?: {
      index?: number;
      range?: number;
      status?: 'active' | 'archived' | 'template';
      sortColumn?: string;
      sortOrder?: 'ascending' | 'descending';
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(this.client.portalPath(pid, '/projects/'), {
      params: {
        index: options?.index,
        range: options?.range,
        status: options?.status,
        sort_column: options?.sortColumn,
        sort_order: options?.sortOrder,
      },
    });
  }

  async getProject(portalId: string | undefined, projectId: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/`),
    );
  }

  async createProject(
    portalId: string | undefined,
    options: {
      name: string;
      description?: string;
      templateId?: number;
      ownerId?: number;
      startDate?: string;
      endDate?: string;
      strictProject?: boolean;
      billingStatus?: string;
      tags?: string;
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(this.client.portalPath(pid, '/projects/'), {
      method: 'POST',
      params: {
        name: options.name,
        description: options.description,
        template_id: options.templateId,
        owner: options.ownerId,
        start_date: options.startDate,
        end_date: options.endDate,
        strict_project: options.strictProject,
        billing_status: options.billingStatus,
        tags: options.tags,
      },
    });
  }

  async updateProject(
    portalId: string | undefined,
    projectId: string,
    options: {
      name?: string;
      description?: string;
      status?: 'active' | 'archived';
      ownerId?: number;
      startDate?: string;
      endDate?: string;
      tags?: string;
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/`),
      {
        method: 'POST',
        params: {
          name: options.name,
          description: options.description,
          status: options.status,
          owner: options.ownerId,
          start_date: options.startDate,
          end_date: options.endDate,
          tags: options.tags,
        },
      },
    );
  }

  async deleteProject(portalId: string | undefined, projectId: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/`),
      { method: 'DELETE' },
    );
  }

  async listTasks(
    portalId: string | undefined,
    projectId: string,
    options?: {
      index?: number;
      range?: number;
      status?: 'open' | 'closed' | 'all';
      ownerEmail?: string;
      tasklistId?: string;
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/tasks/`),
      {
        params: {
          index: options?.index,
          range: options?.range,
          status: options?.status,
          owner: options?.ownerEmail,
          tasklist_id: options?.tasklistId,
        },
      },
    );
  }

  async getTask(portalId: string | undefined, projectId: string, taskId: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(
        pid,
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/`,
      ),
    );
  }

  async createTask(
    portalId: string | undefined,
    projectId: string,
    options: {
      name: string;
      tasklistId?: string;
      personResponsible?: string;
      startDate?: string;
      endDate?: string;
      description?: string;
      priority?: 'None' | 'Low' | 'Medium' | 'High';
      duration?: string;
      durationType?: 'days' | 'hours' | 'weeks';
      workType?: 'billable' | 'non_billable';
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/tasks/`),
      {
        method: 'POST',
        params: {
          name: options.name,
          tasklist_id: options.tasklistId,
          person_responsible: options.personResponsible,
          start_date: options.startDate,
          end_date: options.endDate,
          description: options.description,
          priority: options.priority,
          duration: options.duration,
          duration_type: options.durationType,
          work_type: options.workType,
        },
      },
    );
  }

  async updateTask(
    portalId: string | undefined,
    projectId: string,
    taskId: string,
    options: {
      name?: string;
      description?: string;
      status?: string;
      priority?: 'None' | 'Low' | 'Medium' | 'High';
      personResponsible?: string;
      startDate?: string;
      endDate?: string;
      percentComplete?: number;
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(
        pid,
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/`,
      ),
      {
        method: 'POST',
        params: {
          name: options.name,
          description: options.description,
          status: options.status,
          priority: options.priority,
          person_responsible: options.personResponsible,
          start_date: options.startDate,
          end_date: options.endDate,
          percent_complete: options.percentComplete,
        },
      },
    );
  }

  async deleteTask(portalId: string | undefined, projectId: string, taskId: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(
        pid,
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/`,
      ),
      { method: 'DELETE' },
    );
  }

  async listTasklists(
    portalId: string | undefined,
    projectId: string,
    options?: { flag?: 'internal' | 'external' },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/tasklists/`),
      { params: { flag: options?.flag } },
    );
  }

  async createTasklist(
    portalId: string | undefined,
    projectId: string,
    options: { name: string; flag?: 'internal' | 'external'; milestoneId?: string },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/tasklists/`),
      {
        method: 'POST',
        params: {
          name: options.name,
          flag: options.flag,
          milestone_id: options.milestoneId,
        },
      },
    );
  }

  async listMilestones(
    portalId: string | undefined,
    projectId: string,
    options?: { status?: 'notcompleted' | 'completed'; flag?: 'internal' | 'external' },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/milestones/`),
      { params: { status: options?.status, flag: options?.flag } },
    );
  }

  async createMilestone(
    portalId: string | undefined,
    projectId: string,
    options: {
      name: string;
      ownerId?: string;
      startDate: string;
      endDate: string;
      flag?: 'internal' | 'external';
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/milestones/`),
      {
        method: 'POST',
        params: {
          name: options.name,
          owner: options.ownerId,
          start_date: options.startDate,
          end_date: options.endDate,
          flag: options.flag,
        },
      },
    );
  }

  async listBugs(
    portalId: string | undefined,
    projectId: string,
    options?: { index?: number; range?: number; statusType?: 'open' | 'closed' },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/bugs/`),
      {
        params: {
          index: options?.index,
          range: options?.range,
          statustype: options?.statusType,
        },
      },
    );
  }

  async createBug(
    portalId: string | undefined,
    projectId: string,
    options: {
      title: string;
      description?: string;
      assigneeId?: string;
      reporterId?: string;
      flag?: 'internal' | 'external';
      classification_id?: string;
      severity_id?: string;
      status_id?: string;
      module_id?: string;
      due_date?: string;
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/bugs/`),
      {
        method: 'POST',
        params: {
          title: options.title,
          description: options.description,
          assignee: options.assigneeId,
          reporter: options.reporterId,
          flag: options.flag,
          classification_id: options.classification_id,
          severity_id: options.severity_id,
          status_id: options.status_id,
          module_id: options.module_id,
          due_date: options.due_date,
        },
      },
    );
  }

  async listForums(portalId: string | undefined, projectId: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/forums/`),
    );
  }

  async createForum(
    portalId: string | undefined,
    projectId: string,
    options: {
      name: string;
      content: string;
      type?: string;
      categoryId?: string;
      flag?: 'internal' | 'external';
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/forums/`),
      {
        method: 'POST',
        params: {
          name: options.name,
          content: options.content,
          type: options.type,
          category_id: options.categoryId,
          flag: options.flag,
        },
      },
    );
  }

  async listEvents(
    portalId: string | undefined,
    projectId: string,
    options?: { status?: 'all' | 'active' | 'archived' },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/events/`),
      { params: { status: options?.status } },
    );
  }

  async logTime(
    portalId: string | undefined,
    projectId: string,
    options: {
      date: string;
      hours: string;
      taskId?: string;
      bugId?: string;
      ownerId?: string;
      notes?: string;
      billStatus?: 'Billable' | 'Non Billable';
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/logs/`),
      {
        method: 'POST',
        params: {
          task_id: options.taskId,
          bug_id: options.bugId,
          date: options.date,
          hours: options.hours,
          owner: options.ownerId,
          notes: options.notes,
          bill_status: options.billStatus,
        },
      },
    );
  }

  async listTimeLogs(
    portalId: string | undefined,
    projectId: string,
    options?: {
      usersList?: 'all';
      viewType?: 'day' | 'week' | 'month';
      date?: string;
      billStatus?: 'Billable' | 'Non Billable' | 'All';
    },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/logs/`),
      {
        params: {
          users_list: options?.usersList,
          view_type: options?.viewType,
          date: options?.date,
          bill_status: options?.billStatus,
        },
      },
    );
  }

  async listUsers(
    portalId?: string,
    options?: { userType?: 'active' | 'all' | 'client' | 'deactive' },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(this.client.portalPath(pid, '/users/'), {
      params: { usertype: options?.userType },
    });
  }

  async addUser(
    portalId: string | undefined,
    options: { email: string; role?: string; profileId?: string },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(this.client.portalPath(pid, '/users/'), {
      method: 'POST',
      params: {
        email: options.email,
        role: options.role,
        profile_id: options.profileId,
      },
    });
  }

  async listClients(
    portalId?: string,
    options?: { index?: number; range?: number },
  ): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(this.client.portalPath(pid, '/clients/'), {
      params: { index: options?.index, range: options?.range },
    });
  }

  async listProjectGroups(portalId?: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(this.client.portalPath(pid, '/projectgroups/'));
  }

  async listDocuments(portalId: string | undefined, projectId: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(
      this.client.portalPath(pid, `/projects/${encodeURIComponent(projectId)}/documents/`),
    );
  }

  async listTags(portalId?: string): Promise<unknown> {
    const pid = this.client.requirePortalId(portalId);
    return this.client.request(this.client.portalPath(pid, '/tags/'));
  }

  getClient(): ZohoProjectsClient {
    return this.client;
  }
}
