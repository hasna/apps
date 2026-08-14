import type {
  PatentscopeSearchParams,
  PatentscopeSearchResponse,
  PCTApplication,
  PatentscopeDocument,
  IPCClassification,
} from '../types';
import { WIPOClient } from './client';

/**
 * Patentscope API - PCT international patent application search
 * https://patentscope.wipo.int/
 */
export class PatentscopeApi {
  constructor(private readonly client: WIPOClient) {}

  /**
   * Search PCT applications
   */
  async search(params: PatentscopeSearchParams): Promise<PatentscopeSearchResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      q: params.query,
      start: params.start || 0,
      rows: params.rows || 25,
    };

    if (params.sort) {
      queryParams.sort = params.sort === 'date_asc' ? 'PD asc' : params.sort === 'date_desc' ? 'PD desc' : 'score desc';
    }
    if (params.language) queryParams.lang = params.language;
    if (params.facets !== undefined) queryParams.facets = params.facets;
    if (params.dateFrom) queryParams.df = params.dateFrom;
    if (params.dateTo) queryParams.dt = params.dateTo;
    if (params.applicantCountry) queryParams.fq = `AC:${params.applicantCountry}`;
    if (params.ipc) queryParams.fq = `IC:${params.ipc}`;

    const response = await this.client.patentscopeGet<{
      response?: {
        numFound?: number;
        start?: number;
        docs?: unknown[];
      };
      results?: unknown[];
      total?: number;
      facet_counts?: Record<string, Record<string, number>>;
    }>('/search', queryParams);

    // Handle different response formats
    const docs = response.response?.docs || response.results || [];
    const total = response.response?.numFound || response.total || 0;
    const start = response.response?.start || params.start || 0;

    // Map facets if present
    const facets: Record<string, Array<{ value: string; count: number }>> = {};
    if (response.facet_counts) {
      Object.entries(response.facet_counts).forEach(([field, values]) => {
        facets[field] = Object.entries(values).map(([value, count]) => ({ value, count }));
      });
    }

    return {
      total,
      start,
      rows: params.rows || 25,
      applications: docs.map(this.mapApplication),
      facets: Object.keys(facets).length > 0 ? facets : undefined,
    };
  }

  /**
   * Get PCT application by application number
   */
  async getByApplicationNumber(applicationNumber: string): Promise<PCTApplication | null> {
    // Normalize PCT application number format
    const cleanNumber = this.normalizePCTNumber(applicationNumber);

    try {
      const response = await this.client.patentscopeGet<{
        response?: { docs?: unknown[] };
        application?: unknown;
      }>(`/application/${encodeURIComponent(cleanNumber)}`);

      const doc = response.response?.docs?.[0] || response.application;
      if (!doc) return null;

      return this.mapApplication(doc);
    } catch {
      return null;
    }
  }

  /**
   * Get PCT application by publication number (WO number)
   */
  async getByPublicationNumber(publicationNumber: string): Promise<PCTApplication | null> {
    // Normalize WO publication number format
    const cleanNumber = this.normalizeWONumber(publicationNumber);

    const response = await this.search({
      query: `PN:${cleanNumber}`,
      rows: 1,
    });

    return response.applications[0] || null;
  }

  /**
   * Get documents for a PCT application
   */
  async getDocuments(applicationNumber: string): Promise<PatentscopeDocument[]> {
    const cleanNumber = this.normalizePCTNumber(applicationNumber);

    try {
      const response = await this.client.patentscopeGet<{
        documents?: Array<{
          id?: string;
          type?: string;
          language?: string;
          pageCount?: number;
        }>;
      }>(`/application/${encodeURIComponent(cleanNumber)}/documents`);

      return (response.documents || []).map(doc => ({
        documentId: doc.id || '',
        documentType: this.mapDocumentType(doc.type),
        language: doc.language,
        pageCount: doc.pageCount,
        downloadUrl: `https://patentscope.wipo.int/search/docs2/pct/${cleanNumber}/${doc.id}`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get family members (related applications)
   */
  async getFamily(applicationNumber: string): Promise<PCTApplication[]> {
    const cleanNumber = this.normalizePCTNumber(applicationNumber);

    try {
      const response = await this.client.patentscopeGet<{
        family?: unknown[];
      }>(`/application/${encodeURIComponent(cleanNumber)}/family`);

      return (response.family || []).map(this.mapApplication);
    } catch {
      return [];
    }
  }

  /**
   * Get IPC classification details
   */
  async getIPCClassification(ipcCode: string): Promise<IPCClassification | null> {
    try {
      const response = await this.client.patentscopeGet<{
        code?: string;
        description?: string;
        version?: string;
        section?: string;
        class?: string;
        subclass?: string;
      }>(`/ipc/${encodeURIComponent(ipcCode)}`);

      if (!response.code) return null;

      return {
        code: response.code,
        description: response.description,
        version: response.version,
        section: response.section,
        class: response.class,
        subclass: response.subclass,
      };
    } catch {
      return null;
    }
  }

  /**
   * Search by applicant/inventor name
   */
  async searchByApplicant(applicantName: string, rows = 25): Promise<PatentscopeSearchResponse> {
    return this.search({
      query: `AP:"${applicantName}"`,
      rows,
    });
  }

  /**
   * Search by inventor name
   */
  async searchByInventor(inventorName: string, rows = 25): Promise<PatentscopeSearchResponse> {
    return this.search({
      query: `IN:"${inventorName}"`,
      rows,
    });
  }

  /**
   * Search by IPC classification
   */
  async searchByIPC(ipcCode: string, rows = 25): Promise<PatentscopeSearchResponse> {
    return this.search({
      query: `IC:${ipcCode}`,
      rows,
    });
  }

  /**
   * Get recent PCT applications
   */
  async getRecent(rows = 25): Promise<PatentscopeSearchResponse> {
    return this.search({
      query: '*:*',
      sort: 'date_desc',
      rows,
    });
  }

  private normalizePCTNumber(number: string): string {
    // PCT numbers are like PCT/US2024/123456 or PCTUS2024123456
    let clean = number.toUpperCase().replace(/\s+/g, '');

    // If it doesn't start with PCT, add it
    if (!clean.startsWith('PCT')) {
      clean = 'PCT' + clean;
    }

    // Add slashes if missing: PCT/US/2024/123456 format
    if (!clean.includes('/')) {
      // Try to parse PCTUS2024123456 format
      const match = clean.match(/PCT([A-Z]{2})(\d{4})(\d+)/);
      if (match) {
        clean = `PCT/${match[1]}${match[2]}/${match[3]}`;
      }
    }

    return clean;
  }

  private normalizeWONumber(number: string): string {
    // WO numbers are like WO/2024/123456 or WO2024123456
    let clean = number.toUpperCase().replace(/\s+/g, '');

    if (!clean.startsWith('WO')) {
      clean = 'WO' + clean;
    }

    if (!clean.includes('/')) {
      const match = clean.match(/WO(\d{4})(\d+)/);
      if (match) {
        clean = `WO/${match[1]}/${match[2]}`;
      }
    }

    return clean;
  }

  private mapDocumentType(type?: string): PatentscopeDocument['documentType'] {
    if (!type) return 'other';
    const lower = type.toLowerCase();
    if (lower.includes('application')) return 'application';
    if (lower.includes('publication')) return 'publication';
    if (lower.includes('search') || lower.includes('report')) return 'search-report';
    return 'other';
  }

  private mapApplication(doc: unknown): PCTApplication {
    const d = doc as Record<string, unknown>;
    return {
      applicationNumber: String(d.applicationNumber || d.AN || d.pctNumber || ''),
      publicationNumber: d.publicationNumber as string | undefined || d.PN as string | undefined,
      internationalFilingDate: String(d.internationalFilingDate || d.IFD || d.filingDate || ''),
      publicationDate: d.publicationDate as string | undefined || d.PD as string | undefined,
      title: String(d.title || d.TI || d.inventionTitle || ''),
      titleLanguage: d.titleLanguage as string | undefined || d.TIL as string | undefined,
      abstract: d.abstract as string | undefined || d.AB as string | undefined,
      abstractLanguage: d.abstractLanguage as string | undefined,
      applicants: this.mapApplicants(d),
      inventors: this.mapInventors(d),
      designatedStates: Array.isArray(d.designatedStates) ? d.designatedStates.map(String) : undefined,
      ipcClassifications: this.mapIPCClassifications(d),
      priorities: this.mapPriorities(d),
      pctStatus: d.status as string | undefined || d.pctStatus as string | undefined,
      nationalPhaseEntries: this.mapNationalPhaseEntries(d),
    };
  }

  private mapApplicants(d: Record<string, unknown>): PCTApplication['applicants'] {
    const applicants = d.applicants || d.AP;
    if (!Array.isArray(applicants)) {
      if (typeof applicants === 'string') {
        return [{ name: applicants }];
      }
      return undefined;
    }

    return applicants.map((a: unknown) => {
      if (typeof a === 'string') {
        return { name: a };
      }
      const app = a as Record<string, unknown>;
      return {
        name: String(app.name || app.applicantName || ''),
        address: app.address as string | undefined,
        country: app.country as string | undefined || app.countryCode as string | undefined,
        type: (app.type as 'individual' | 'organization') || undefined,
      };
    });
  }

  private mapInventors(d: Record<string, unknown>): PCTApplication['inventors'] {
    const inventors = d.inventors || d.IN;
    if (!Array.isArray(inventors)) {
      if (typeof inventors === 'string') {
        return [{ name: inventors }];
      }
      return undefined;
    }

    return inventors.map((i: unknown) => {
      if (typeof i === 'string') {
        return { name: i };
      }
      const inv = i as Record<string, unknown>;
      return {
        name: String(inv.name || inv.inventorName || ''),
        address: inv.address as string | undefined,
        country: inv.country as string | undefined || inv.countryCode as string | undefined,
      };
    });
  }

  private mapIPCClassifications(d: Record<string, unknown>): PCTApplication['ipcClassifications'] {
    const ipc = d.ipcClassifications || d.IC || d.classifications;
    if (!Array.isArray(ipc)) {
      if (typeof ipc === 'string') {
        return [{ code: ipc }];
      }
      return undefined;
    }

    return ipc.map((c: unknown) => {
      if (typeof c === 'string') {
        return { code: c };
      }
      const cls = c as Record<string, unknown>;
      return {
        code: String(cls.code || cls.ipcCode || ''),
        description: cls.description as string | undefined,
        version: cls.version as string | undefined,
        section: cls.section as string | undefined,
        class: cls.class as string | undefined,
        subclass: cls.subclass as string | undefined,
      };
    });
  }

  private mapPriorities(d: Record<string, unknown>): PCTApplication['priorities'] {
    const priorities = d.priorities || d.priorityClaims;
    if (!Array.isArray(priorities)) return undefined;

    return priorities.map((p: unknown) => {
      const pri = p as Record<string, unknown>;
      return {
        applicationNumber: String(pri.applicationNumber || pri.priorityNumber || ''),
        filingDate: String(pri.filingDate || pri.priorityDate || ''),
        country: String(pri.country || pri.countryCode || ''),
      };
    });
  }

  private mapNationalPhaseEntries(d: Record<string, unknown>): PCTApplication['nationalPhaseEntries'] {
    const entries = d.nationalPhaseEntries || d.nationalPhase;
    if (!Array.isArray(entries)) return undefined;

    return entries.map((e: unknown) => {
      const entry = e as Record<string, unknown>;
      return {
        country: String(entry.country || entry.countryCode || ''),
        applicationNumber: entry.applicationNumber as string | undefined,
        entryDate: entry.entryDate as string | undefined,
        status: entry.status as string | undefined,
      };
    });
  }
}
