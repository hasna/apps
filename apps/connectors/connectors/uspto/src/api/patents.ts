import type {
  PatentSearchParams,
  PatentSearchResponse,
  Patent,
  PatentFileWrapper,
  PatentAssignment,
  PatentDocument,
} from '../types';
import { USPTOClient } from './client';

/**
 * Patents API - Search patents, get file wrappers, assignments
 */
export class PatentsApi {
  constructor(private readonly client: USPTOClient) {}

  /**
   * Search patents using Open Data Portal
   */
  async search(params: PatentSearchParams): Promise<PatentSearchResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      q: params.query,
      start: params.start || 0,
      rows: params.rows || 25,
    };

    if (params.sort) queryParams.sort = params.sort;
    if (params.facet !== undefined) queryParams.facet = params.facet;
    if (params.fl) queryParams.fl = params.fl.join(',');

    const response = await this.client.odpGet<{
      response?: {
        numFound?: number;
        start?: number;
        docs?: unknown[];
      };
      results?: unknown[];
      total?: number;
    }>('/patents/search', queryParams);

    // Handle different response formats
    const docs = response.response?.docs || response.results || [];
    const total = response.response?.numFound || response.total || 0;
    const start = response.response?.start || params.start || 0;

    return {
      total,
      start,
      rows: params.rows || 25,
      patents: docs.map(this.mapPatent),
    };
  }

  /**
   * Get patent by number
   */
  async getByNumber(patentNumber: string): Promise<Patent | null> {
    const cleanNumber = patentNumber.replace(/[^0-9]/g, '');

    const response = await this.client.odpGet<{
      response?: { docs?: unknown[] };
      patent?: unknown;
    }>(`/patents/${cleanNumber}`);

    const doc = response.response?.docs?.[0] || response.patent;
    if (!doc) return null;

    return this.mapPatent(doc);
  }

  /**
   * Get patent file wrapper (PEDS - Patent Examination Data System)
   */
  async getFileWrapper(applicationNumber: string): Promise<PatentFileWrapper | null> {
    const cleanNumber = applicationNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.pedsGet<{
        queryResults?: {
          searchResponse?: {
            response?: {
              docs?: Array<{
                appFilingDate?: string;
                appStatus?: string;
                appType?: string;
                continuityData?: unknown[];
                transactionHistory?: unknown[];
              }>;
            };
          };
        };
      }>('/queries', {
        searchText: `applId:${cleanNumber}`,
        df: 'patentTitle',
        facet: false,
        sort: 'applId asc',
        fl: '*',
      });

      const doc = response.queryResults?.searchResponse?.response?.docs?.[0];
      if (!doc) return null;

      return {
        applicationNumber: cleanNumber,
        filingDate: doc.appFilingDate || '',
        status: doc.appStatus || '',
        applicationType: doc.appType || '',
        documents: [],
        continuity: (doc.continuityData || []).map((c: unknown) => {
          const cont = c as Record<string, unknown>;
          return {
            parentApplicationNumber: String(cont.parentApplicationId || ''),
            parentFilingDate: String(cont.parentFilingDate || ''),
            claimType: String(cont.claimType || ''),
            description: String(cont.description || ''),
          };
        }),
        transactions: (doc.transactionHistory || []).map((t: unknown) => {
          const trans = t as Record<string, unknown>;
          return {
            date: String(trans.recordDate || ''),
            code: String(trans.code || ''),
            description: String(trans.description || ''),
          };
        }),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get documents for a patent application
   */
  async getDocuments(applicationNumber: string): Promise<PatentDocument[]> {
    const cleanNumber = applicationNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.odpGet<{
        documents?: Array<{
          documentIdentifier?: string;
          documentCategory?: string;
          mailRoomDate?: string;
          pageCount?: number;
        }>;
      }>(`/patent-file-wrapper/documents/${cleanNumber}`);

      return (response.documents || []).map(doc => ({
        documentId: doc.documentIdentifier || '',
        documentType: doc.documentCategory || '',
        mailDate: doc.mailRoomDate,
        pageCount: doc.pageCount,
        downloadUrl: `https://data.uspto.gov/api/v1/patent-file-wrapper/documents/${cleanNumber}/${doc.documentIdentifier}/download`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Search patent assignments
   */
  async searchAssignments(params: {
    patentNumber?: string;
    assignee?: string;
    assignor?: string;
  }): Promise<PatentAssignment[]> {
    const queryParams: Record<string, string | undefined> = {};

    if (params.patentNumber) {
      queryParams.filter = `PatentNumber:${params.patentNumber}`;
    } else if (params.assignee) {
      queryParams.filter = `AssigneeName:${params.assignee}`;
    } else if (params.assignor) {
      queryParams.filter = `AssignorName:${params.assignor}`;
    }

    try {
      const response = await this.client.patentAssignmentGet<{
        results?: Array<{
          reelFrame?: string;
          recordedDate?: string;
          executionDate?: string;
          assignorName?: string;
          assigneeName?: string;
          conveyanceText?: string;
          patentNumbers?: string[];
          applicationNumbers?: string[];
        }>;
      }>('', queryParams);

      return (response.results || []).map(r => ({
        reelFrame: r.reelFrame || '',
        recordDate: r.recordedDate || '',
        executionDate: r.executionDate,
        assignor: r.assignorName || '',
        assignee: r.assigneeName || '',
        conveyanceText: r.conveyanceText,
        patentNumbers: r.patentNumbers,
        applicationNumbers: r.applicationNumbers,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get patent claims
   */
  async getClaims(patentNumber: string): Promise<string[]> {
    const patent = await this.getByNumber(patentNumber);
    return patent?.claims || [];
  }

  /**
   * Get patent citations
   */
  async getCitations(patentNumber: string): Promise<Patent['citations']> {
    const patent = await this.getByNumber(patentNumber);
    return patent?.citations || [];
  }

  private mapPatent(doc: unknown): Patent {
    const d = doc as Record<string, unknown>;
    return {
      patentNumber: String(d.patentNumber || d.patent_number || d.documentId || ''),
      publicationNumber: d.publicationNumber as string | undefined,
      applicationNumber: String(d.applicationNumber || d.app_number || ''),
      title: String(d.patentTitle || d.title || d.inventionTitle || ''),
      abstract: d.abstract as string | undefined,
      inventors: Array.isArray(d.inventors)
        ? d.inventors.map(String)
        : d.inventorName
          ? [String(d.inventorName)]
          : undefined,
      assignees: Array.isArray(d.assignees)
        ? d.assignees.map(String)
        : d.assigneeName
          ? [String(d.assigneeName)]
          : undefined,
      filingDate: d.filingDate as string | undefined,
      publicationDate: d.publicationDate as string | undefined,
      grantDate: d.grantDate as string | undefined,
      claims: Array.isArray(d.claims) ? d.claims.map(String) : undefined,
      classifications: this.mapClassifications(d),
      citations: this.mapCitations(d),
      status: d.status as string | undefined,
      type: d.patentType as Patent['type'],
    };
  }

  private mapClassifications(d: Record<string, unknown>): Patent['classifications'] {
    const classifications: Patent['classifications'] = [];

    if (Array.isArray(d.cpcCodes)) {
      d.cpcCodes.forEach((code: unknown) => {
        classifications.push({ type: 'CPC', code: String(code) });
      });
    }

    if (Array.isArray(d.ipcCodes)) {
      d.ipcCodes.forEach((code: unknown) => {
        classifications.push({ type: 'IPC', code: String(code) });
      });
    }

    if (Array.isArray(d.uspcCodes)) {
      d.uspcCodes.forEach((code: unknown) => {
        classifications.push({ type: 'USPC', code: String(code) });
      });
    }

    return classifications.length > 0 ? classifications : undefined;
  }

  private mapCitations(d: Record<string, unknown>): Patent['citations'] {
    if (!Array.isArray(d.citations)) return undefined;

    return d.citations.map((c: unknown) => {
      const cit = c as Record<string, unknown>;
      return {
        patentNumber: cit.patentNumber as string | undefined,
        publicationNumber: cit.publicationNumber as string | undefined,
        date: cit.date as string | undefined,
        name: cit.name as string | undefined,
        category: (cit.category as 'patent' | 'non-patent') || 'patent',
      };
    });
  }
}
