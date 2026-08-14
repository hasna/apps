// Zoho People Connector — HR, employees, leave, attendance, and timesheets
import { ZohoPeopleClient } from './client';
import type { ZohoPeopleConfig, ZohoPeopleResponse } from '../types';

export { ZohoPeopleClient, DATA_CENTER_BASES, resolveBaseUrl } from './client';

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Zoho People: ${label} is required`);
  }
  return value.trim();
}

export class ZohoPeople {
  private readonly client: ZohoPeopleClient;

  constructor(config: ZohoPeopleConfig) {
    this.client = new ZohoPeopleClient(config);
  }

  static fromEnv(): ZohoPeople {
    const token = process.env.ZOHOPEOPLE_TOKEN;
    if (!token) throw new Error('ZOHOPEOPLE_TOKEN is required');
    return new ZohoPeople({
      token,
      dataCenter: process.env.ZOHOPEOPLE_DATA_CENTER,
      baseUrl: process.env.ZOHOPEOPLE_BASE_URL,
    });
  }

  async listEmployees(options: {
    sIndex?: number;
    limit?: number;
    modifiedTime?: string;
    searchParams?: Record<string, unknown>;
  } = {}): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/employee/getRecords', {
      query: {
        sIndex: options.sIndex,
        limit: options.limit,
        modifiedtime: options.modifiedTime,
        searchParams: options.searchParams ? JSON.stringify(options.searchParams) : undefined,
      },
    });
  }

  async getEmployee(recordId: string): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/employee/getRecordByID', {
      query: { recordId: requireString(recordId, 'recordId') },
    });
  }

  async getEmployeeByEmail(email: string): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/P_EmpView/records', {
      query: {
        searchColumn: 'EmailID',
        searchValue: requireString(email, 'email'),
      },
    });
  }

  async addEmployee(inputData: Record<string, unknown>): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/forms/employee/insertRecord', { body: { inputData } });
  }

  async updateEmployee(recordId: string, inputData: Record<string, unknown>): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/forms/employee/updateRecord', {
      body: {
        recordId: requireString(recordId, 'recordId'),
        inputData,
      },
    });
  }

  async listDepartments(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/department/getRecords');
  }

  async listDesignations(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/designation/getRecords');
  }

  async listLocations(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/location/getRecords');
  }

  async applyLeave(inputData: Record<string, unknown>): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/forms/leave/insertRecord', { body: { inputData } });
  }

  async listLeaveBalance(userId: string): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/leave/getLeaveTypeDetails', {
      query: { userId: requireString(userId, 'userId') },
    });
  }

  async listLeaves(options: { sIndex?: number; limit?: number; modifiedTime?: string } = {}): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/leave/getRecords', {
      query: {
        sIndex: options.sIndex,
        limit: options.limit,
        modifiedtime: options.modifiedTime,
      },
    });
  }

  async approveLeave(recordId: string): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/leave/approveLeave', {
      body: { recordId: requireString(recordId, 'recordId') },
    });
  }

  async cancelLeave(recordId: string, cancelReason?: string): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/leave/cancelLeave', {
      body: {
        recordId: requireString(recordId, 'recordId'),
        cancelReason,
      },
    });
  }

  async getAttendance(options: {
    sDate: string;
    eDate: string;
    userId?: string;
    erecno?: string;
  }): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/attendance/getUserReport', {
      query: {
        sdate: requireString(options.sDate, 'sDate'),
        edate: requireString(options.eDate, 'eDate'),
        userId: options.userId,
        erecno: options.erecno,
      },
    });
  }

  async checkIn(options: {
    empId?: string;
    mode?: 'WEB' | 'MOBILE';
    latitude?: string;
    longitude?: string;
  } = {}): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/attendance/checkIn', { body: options });
  }

  async checkOut(options: {
    empId?: string;
    mode?: 'WEB' | 'MOBILE';
    latitude?: string;
    longitude?: string;
  } = {}): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/attendance/checkOut', { body: options });
  }

  async addBulkPunch(entries: Array<Record<string, unknown>>): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/attendance/bulkImport', { body: { data: entries } });
  }

  async getShifts(options: { date?: string; userId?: string } = {}): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/attendance/getShiftDetails', {
      query: { date: options.date, userId: options.userId },
    });
  }

  async listOnDuty(options: { sDate: string; eDate: string; userId?: string }): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/attendance/getOnDuty', {
      query: {
        sdate: requireString(options.sDate, 'sDate'),
        edate: requireString(options.eDate, 'eDate'),
        userId: options.userId,
      },
    });
  }

  async listTimesheets(options: { sIndex?: number; limit?: number } = {}): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/timetracker/timelogs', {
      query: { sIndex: options.sIndex, limit: options.limit },
    });
  }

  async addTimesheet(options: {
    jobId: string;
    workDate: string;
    hours: string;
    billingStatus?: 'Billable' | 'Non Billable';
    description?: string;
  }): Promise<ZohoPeopleResponse> {
    return this.client.request('POST', '/timetracker/addtimelog', {
      body: {
        jobId: requireString(options.jobId, 'jobId'),
        workDate: requireString(options.workDate, 'workDate'),
        hours: requireString(options.hours, 'hours'),
        billingStatus: options.billingStatus,
        description: options.description,
      },
    });
  }

  async listJobs(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/timetracker/jobs');
  }

  async listClients(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/timetracker/clients');
  }

  async getOrganizationDetails(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms/general/getOrgDetails');
  }

  async listForms(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/forms');
  }

  async getFormFields(formName: string): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', `/forms/${encodeURIComponent(requireString(formName, 'formName'))}/components`);
  }

  async listAnnouncements(): Promise<ZohoPeopleResponse> {
    return this.client.request('GET', '/announcements');
  }

  getClient(): ZohoPeopleClient {
    return this.client;
  }
}
