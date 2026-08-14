import type {
  PTABSearchParams,
  PTABSearchResponse,
  PTABProceeding,
  PTABDocument,
} from '../types';
import { USPTOClient } from './client';

/**
 * PTAB API - Patent Trial and Appeal Board proceedings
 */
export class PTABApi {
  constructor(private readonly client: USPTOClient) {}

  /**
   * Search PTAB proceedings
   */
  async search(params: PTABSearchParams = {}): Promise<PTABSearchResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      start: params.start || 0,
      rows: params.rows || 25,
    };

    if (params.query) queryParams.q = params.query;
    if (params.proceedingNumber) queryParams.proceedingNumber = params.proceedingNumber;
    if (params.patentNumber) queryParams.patentNumber = params.patentNumber;
    if (params.petitioner) queryParams.petitionerPartyName = params.petitioner;
    if (params.patentOwner) queryParams.patentOwnerName = params.patentOwner;
    if (params.type) queryParams.type = params.type;
    if (params.status) queryParams.status = params.status;

    const response = await this.client.ptabGet<{
      results?: unknown[];
      total?: number;
      start?: number;
    }>('/search', queryParams);

    return {
      total: response.total || 0,
      start: response.start || params.start || 0,
      rows: params.rows || 25,
      proceedings: (response.results || []).map(this.mapProceeding),
    };
  }

  /**
   * Get proceeding by number
   */
  async getByNumber(proceedingNumber: string): Promise<PTABProceeding | null> {
    try {
      const response = await this.client.ptabGet<{
        results?: unknown[];
      }>(`/${proceedingNumber}`);

      const proc = response.results?.[0];
      if (!proc) return null;

      return this.mapProceeding(proc);
    } catch {
      return null;
    }
  }

  /**
   * Get proceedings for a patent
   */
  async getForPatent(patentNumber: string): Promise<PTABProceeding[]> {
    const cleanNumber = patentNumber.replace(/[^0-9]/g, '');

    const response = await this.search({
      patentNumber: cleanNumber,
      rows: 100,
    });

    return response.proceedings;
  }

  /**
   * Get documents for a proceeding
   */
  async getDocuments(proceedingNumber: string): Promise<PTABDocument[]> {
    try {
      const response = await this.client.ptabGet<{
        documents?: Array<{
          documentIdentifier?: string;
          documentCategory?: string;
          filingDate?: string;
          filingPartyCategory?: string;
          pageCount?: number;
        }>;
      }>(`/${proceedingNumber}/documents`);

      return (response.documents || []).map(doc => ({
        documentId: doc.documentIdentifier || '',
        documentType: doc.documentCategory || '',
        filingDate: doc.filingDate || '',
        partyName: doc.filingPartyCategory,
        pageCount: doc.pageCount,
        downloadUrl: `https://developer.uspto.gov/ptab-api/proceedings/${proceedingNumber}/documents/${doc.documentIdentifier}`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get IPR (Inter Partes Review) proceedings
   */
  async getIPRProceedings(params: Omit<PTABSearchParams, 'type'> = {}): Promise<PTABSearchResponse> {
    return this.search({ ...params, type: 'IPR' });
  }

  /**
   * Get PGR (Post-Grant Review) proceedings
   */
  async getPGRProceedings(params: Omit<PTABSearchParams, 'type'> = {}): Promise<PTABSearchResponse> {
    return this.search({ ...params, type: 'PGR' });
  }

  /**
   * Get appeal proceedings
   */
  async getAppeals(params: Omit<PTABSearchParams, 'type'> = {}): Promise<PTABSearchResponse> {
    return this.search({ ...params, type: 'APPEAL' });
  }

  /**
   * Check if patent has any PTAB proceedings
   */
  async hasProceedings(patentNumber: string): Promise<boolean> {
    const proceedings = await this.getForPatent(patentNumber);
    return proceedings.length > 0;
  }

  private mapProceeding(doc: unknown): PTABProceeding {
    const d = doc as Record<string, unknown>;
    return {
      proceedingNumber: String(d.proceedingNumber || d.trialNumber || ''),
      type: (d.type || d.proceedingType) as PTABProceeding['type'],
      status: String(d.status || d.proceedingStatus || ''),
      filingDate: String(d.filingDate || d.accordedFilingDate || ''),
      institutionDate: d.institutionDate as string | undefined,
      decisionDate: d.decisionDate as string | undefined,
      patentNumber: d.patentNumber as string | undefined,
      patentOwner: d.patentOwnerName as string | undefined,
      petitioner: d.petitionerPartyName as string | undefined,
      accordedFilingDate: d.accordedFilingDate as string | undefined,
    };
  }
}
