import type { MaropostClient } from './client';
import type {
  ReportFilters,
  OpenReport,
  ClickReport,
  BounceReport,
  UnsubscribeReport,
  ComplaintReport,
  ReportListResponse,
  Journey,
  JourneyResponse,
} from '../types';

/**
 * Reports API module for Maropost
 * Provides access to account-wide reports and analytics
 */
export class ReportsApi {
  constructor(private readonly client: MaropostClient) {}

  /**
   * Build query params from report filters
   */
  private buildFilterParams(filters?: ReportFilters): Record<string, string | number | boolean | undefined> {
    if (!filters) return {};

    return {
      page: filters.page,
      per: filters.per,
      from: filters.from,
      to: filters.to,
      unique: filters.unique,
      email: filters.email,
      uid: filters.uid,
      fields: filters.fields?.join(','),
    };
  }

  /**
   * Get opens report
   */
  async getOpens(filters?: ReportFilters): Promise<ReportListResponse<OpenReport>> {
    return this.client.get<ReportListResponse<OpenReport>>(
      '/reports/opens.json',
      this.buildFilterParams(filters)
    );
  }

  /**
   * Get clicks report
   */
  async getClicks(filters?: ReportFilters): Promise<ReportListResponse<ClickReport>> {
    return this.client.get<ReportListResponse<ClickReport>>(
      '/reports/clicks.json',
      this.buildFilterParams(filters)
    );
  }

  /**
   * Get bounces report
   */
  async getBounces(filters?: ReportFilters & { type?: 'soft' | 'hard' }): Promise<ReportListResponse<BounceReport>> {
    const params = this.buildFilterParams(filters);
    if (filters?.type) {
      params.type = filters.type;
    }
    return this.client.get<ReportListResponse<BounceReport>>('/reports/bounces.json', params);
  }

  /**
   * Get unsubscribes report
   */
  async getUnsubscribes(filters?: ReportFilters): Promise<ReportListResponse<UnsubscribeReport>> {
    return this.client.get<ReportListResponse<UnsubscribeReport>>(
      '/reports/unsubscribes.json',
      this.buildFilterParams(filters)
    );
  }

  /**
   * Get complaints report
   */
  async getComplaints(filters?: ReportFilters): Promise<ReportListResponse<ComplaintReport>> {
    return this.client.get<ReportListResponse<ComplaintReport>>(
      '/reports/complaints.json',
      this.buildFilterParams(filters)
    );
  }

  /**
   * Get all reports list
   */
  async list(page?: number): Promise<{ data: unknown[]; total_pages: number; current_page: number }> {
    return this.client.get('/reports.json', { page });
  }

  /**
   * Get a specific report by ID
   */
  async get(id: number): Promise<unknown> {
    return this.client.get(`/reports/${id}.json`);
  }

  /**
   * Get A/B test reports
   */
  async getAbReports(name: string, options?: { page?: number; from?: string; to?: string; per?: number }): Promise<unknown> {
    return this.client.get('/ab_reports.json', {
      name,
      page: options?.page,
      from: options?.from,
      to: options?.to,
      per: options?.per,
    });
  }

  /**
   * Get journeys report
   */
  async getJourneys(page?: number): Promise<JourneyResponse> {
    return this.client.get<JourneyResponse>('/journeys.json', { page });
  }
}
