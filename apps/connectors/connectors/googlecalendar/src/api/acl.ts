import type { GoogleCalendarClient } from './client';
import type { CalendarAcl, CalendarAclListResponse, CalendarAclInsert } from '../types';

/**
 * Calendar ACL API module - manage calendar access control lists
 */
export class AclApi {
  constructor(private readonly client: GoogleCalendarClient) {}

  /**
   * List ACL rules for a calendar
   */
  async list(calendarId: string, options: { maxResults?: number; pageToken?: string } = {}): Promise<CalendarAclListResponse> {
    const params: Record<string, number | string | undefined> = {};
    if (options.maxResults) params.maxResults = options.maxResults;
    if (options.pageToken) params.pageToken = options.pageToken;
    return this.client.get<CalendarAclListResponse>(`/calendars/${encodeURIComponent(calendarId)}/acl`, params);
  }

  /**
   * Iterate over all ACL rules (handles pagination)
   */
  async *listAll(calendarId: string): AsyncGenerator<CalendarAcl> {
    let nextPageToken: string | undefined;
    do {
      const result = await this.list(calendarId, { pageToken: nextPageToken });
      for (const rule of result.items) {
        yield rule;
      }
      nextPageToken = result.nextPageToken;
    } while (nextPageToken);
  }

  /**
   * Get a specific ACL rule
   */
  async get(calendarId: string, ruleId: string): Promise<CalendarAcl> {
    return this.client.get<CalendarAcl>(`/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(ruleId)}`);
  }

  /**
   * Insert a new ACL rule
   */
  async insert(calendarId: string, rule: CalendarAclInsert): Promise<CalendarAcl> {
    return this.client.post<CalendarAcl>(`/calendars/${encodeURIComponent(calendarId)}/acl`, {
      role: rule.role,
      scope: rule.scope,
    });
  }

  /**
   * Delete an ACL rule
   */
  async delete(calendarId: string, ruleId: string): Promise<void> {
    await this.client.delete<void>(`/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(ruleId)}`);
  }

  /**
   * Update an ACL rule
   */
  async update(calendarId: string, ruleId: string, role: CalendarAclInsert['role']): Promise<CalendarAcl> {
    return this.client.patch<CalendarAcl>(`/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(ruleId)}`, {
      role,
    });
  }
}
