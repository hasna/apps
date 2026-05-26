import type {
  TrademarkSearchParams,
  TrademarkSearchResponse,
  Trademark,
  TrademarkAssignment,
  TrademarkDocument,
  TSDRStatus,
} from '../types';
import { USPTOClient } from './client';

/**
 * Trademarks API - Search trademarks, get status, assignments
 */
export class TrademarksApi {
  constructor(private readonly client: USPTOClient) {}

  /**
   * Search trademarks
   */
  async search(params: TrademarkSearchParams): Promise<TrademarkSearchResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      q: params.query,
      start: params.start || 0,
      rows: params.rows || 25,
    };

    if (params.status && params.status !== 'all') {
      queryParams.fq = params.status === 'live' ? 'status_code:[600 TO 699]' : 'status_code:[900 TO 999]';
    }

    const response = await this.client.odpGet<{
      response?: {
        numFound?: number;
        start?: number;
        docs?: unknown[];
      };
      results?: unknown[];
      total?: number;
    }>('/trademarks/search', queryParams);

    const docs = response.response?.docs || response.results || [];
    const total = response.response?.numFound || response.total || 0;
    const start = response.response?.start || params.start || 0;

    return {
      total,
      start,
      rows: params.rows || 25,
      trademarks: docs.map(this.mapTrademark),
    };
  }

  /**
   * Get trademark by serial number
   */
  async getBySerialNumber(serialNumber: string): Promise<Trademark | null> {
    const cleanNumber = serialNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.odpGet<{
        response?: { docs?: unknown[] };
        trademark?: unknown;
      }>(`/trademarks/${cleanNumber}`);

      const doc = response.response?.docs?.[0] || response.trademark;
      if (!doc) return null;

      return this.mapTrademark(doc);
    } catch {
      return null;
    }
  }

  /**
   * Get trademark by registration number
   */
  async getByRegistrationNumber(registrationNumber: string): Promise<Trademark | null> {
    const cleanNumber = registrationNumber.replace(/[^0-9]/g, '');

    const response = await this.search({
      query: `registration_number:${cleanNumber}`,
      rows: 1,
    });

    return response.trademarks[0] || null;
  }

  /**
   * Get TSDR status (Trademark Status & Document Retrieval)
   */
  async getTSDRStatus(serialNumber: string): Promise<TSDRStatus | null> {
    const cleanNumber = serialNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.tsdrGet<{
        trademarkNumber?: string;
        registrationNumber?: string;
        markElement?: string;
        markCurrentStatusExternalDescriptionText?: string;
        markCurrentStatusDate?: string;
        applicationFilingDate?: string;
        registrationDate?: string;
        applicantInfo?: {
          applicantName?: string;
          applicantAddressLine1?: string;
          applicantAddressCity?: string;
          applicantAddressGeoRegionOrState?: string;
          applicantAddressCountryCode?: string;
          applicantEntityTypeCategory?: string;
        };
        prosecutionHistory?: Array<{
          prosecutionEventDate?: string;
          prosecutionEventDescription?: string;
          prosecutionEventTypeCode?: string;
        }>;
      }>(`/trademark/status/${cleanNumber}`, {
        format: 'json',
      });

      return {
        serialNumber: cleanNumber,
        registrationNumber: response.registrationNumber,
        markText: response.markElement,
        status: response.markCurrentStatusExternalDescriptionText || '',
        statusDate: response.markCurrentStatusDate || '',
        filingDate: response.applicationFilingDate || '',
        registrationDate: response.registrationDate,
        owner: response.applicantInfo ? {
          name: response.applicantInfo.applicantName || '',
          address: response.applicantInfo.applicantAddressLine1,
          city: response.applicantInfo.applicantAddressCity,
          state: response.applicantInfo.applicantAddressGeoRegionOrState,
          country: response.applicantInfo.applicantAddressCountryCode,
          entityType: response.applicantInfo.applicantEntityTypeCategory,
        } : undefined,
        prosecutionHistory: (response.prosecutionHistory || []).map(e => ({
          date: e.prosecutionEventDate || '',
          description: e.prosecutionEventDescription || '',
          code: e.prosecutionEventTypeCode,
        })),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get trademark documents
   */
  async getDocuments(serialNumber: string): Promise<TrademarkDocument[]> {
    const cleanNumber = serialNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.tsdrGet<{
        documents?: Array<{
          documentId?: string;
          documentTypeCode?: string;
          createDate?: string;
          documentTypeDescription?: string;
        }>;
      }>(`/trademark/documents/${cleanNumber}`, {
        format: 'json',
      });

      return (response.documents || []).map(doc => ({
        documentId: doc.documentId || '',
        documentType: doc.documentTypeCode || '',
        createDate: doc.createDate,
        description: doc.documentTypeDescription,
        downloadUrl: `https://tsdrapi.uspto.gov/trademark/documents/${cleanNumber}/${doc.documentId}`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Search trademark assignments
   */
  async searchAssignments(params: {
    serialNumber?: string;
    registrationNumber?: string;
    assignee?: string;
    assignor?: string;
  }): Promise<TrademarkAssignment[]> {
    const queryParams: Record<string, string | undefined> = {};

    if (params.serialNumber) {
      queryParams.filter = `SerialNumber:${params.serialNumber}`;
    } else if (params.registrationNumber) {
      queryParams.filter = `RegistrationNumber:${params.registrationNumber}`;
    } else if (params.assignee) {
      queryParams.filter = `AssigneeName:${params.assignee}`;
    } else if (params.assignor) {
      queryParams.filter = `AssignorName:${params.assignor}`;
    }

    try {
      const response = await this.client.trademarkAssignmentGet<{
        results?: Array<{
          reelFrame?: string;
          recordedDate?: string;
          executionDate?: string;
          assignorName?: string;
          assigneeName?: string;
          conveyanceType?: string;
          serialNumbers?: string[];
          registrationNumbers?: string[];
        }>;
      }>('', queryParams);

      return (response.results || []).map(r => ({
        reelFrame: r.reelFrame || '',
        recordDate: r.recordedDate || '',
        executionDate: r.executionDate,
        assignor: r.assignorName || '',
        assignee: r.assigneeName || '',
        conveyanceType: r.conveyanceType,
        serialNumbers: r.serialNumbers,
        registrationNumbers: r.registrationNumbers,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Check if a trademark is available (basic check)
   */
  async checkAvailability(markText: string): Promise<{
    available: boolean;
    conflicts: Trademark[];
  }> {
    const response = await this.search({
      query: markText,
      status: 'live',
      rows: 50,
    });

    // Check for exact or similar matches
    const conflicts = response.trademarks.filter(tm => {
      const tmText = (tm.markText || '').toLowerCase();
      const searchText = markText.toLowerCase();
      return tmText === searchText || tmText.includes(searchText) || searchText.includes(tmText);
    });

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }

  private mapTrademark(doc: unknown): Trademark {
    const d = doc as Record<string, unknown>;
    return {
      serialNumber: String(d.serialNumber || d.serial_number || ''),
      registrationNumber: d.registrationNumber as string | undefined,
      markText: String(d.markElement || d.mark_text || d.wordMark || ''),
      markDrawingCode: d.markDrawingCode as string | undefined,
      goodsServices: d.goodsServicesText as string | undefined,
      filingDate: d.filingDate as string | undefined,
      registrationDate: d.registrationDate as string | undefined,
      status: String(d.markCurrentStatusExternalDescriptionText || d.status || ''),
      statusDate: d.markCurrentStatusDate as string | undefined,
      owner: d.applicantName ? {
        name: String(d.applicantName),
        address: d.applicantAddress as string | undefined,
        city: d.applicantCity as string | undefined,
        state: d.applicantState as string | undefined,
        country: d.applicantCountry as string | undefined,
        entityType: d.applicantEntityType as string | undefined,
      } : undefined,
      attorney: d.attorneyName as string | undefined,
      classifications: this.mapClassifications(d),
      designCodes: Array.isArray(d.designCodes) ? d.designCodes.map(String) : undefined,
      imageUrl: d.imageUrl as string | undefined,
    };
  }

  private mapClassifications(d: Record<string, unknown>): Trademark['classifications'] {
    const classes = Array.isArray(d.classifications)
      ? d.classifications
      : Array.isArray(d.niceClassifications)
        ? d.niceClassifications
        : null;

    if (!classes) {
      return undefined;
    }

    return classes.map((c: unknown) => {
      if (typeof c === 'number') {
        return { classNumber: c, description: '' };
      }
      const cls = c as Record<string, unknown>;
      return {
        classNumber: Number(cls.classNumber || cls.number || 0),
        description: String(cls.description || cls.text || ''),
      };
    });
  }
}
