import type {
  MadridSearchParams,
  MadridSearchResponse,
  MadridMark,
  MadridDocument,
  DesignatedCountry,
  NiceClassification,
} from '../types';
import { WIPOClient } from './client';

/**
 * Madrid System API - International trademark registrations
 * https://www.wipo.int/madrid/en/
 */
export class MadridApi {
  constructor(private readonly client: WIPOClient) {}

  /**
   * Search international trademark registrations
   */
  async search(params: MadridSearchParams): Promise<MadridSearchResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      start: params.start || 0,
      rows: params.rows || 25,
    };

    // Build query based on parameters
    const queryParts: string[] = [];
    if (params.query) queryParts.push(params.query);
    if (params.markName) queryParts.push(`MN:"${params.markName}"`);
    if (params.holderName) queryParts.push(`HOL:"${params.holderName}"`);
    if (params.holderCountry) queryParts.push(`HOLCO:${params.holderCountry}`);
    if (params.designatedCountry) queryParts.push(`DS:${params.designatedCountry}`);
    if (params.niceClass) {
      const classes = Array.isArray(params.niceClass) ? params.niceClass : [params.niceClass];
      queryParts.push(`NC:(${classes.join(' OR ')})`);
    }

    queryParams.q = queryParts.length > 0 ? queryParts.join(' AND ') : '*:*';

    if (params.status && params.status !== 'all') {
      queryParams.fq = params.status === 'active' ? 'status:active' : 'status:inactive';
    }

    if (params.sort) {
      queryParams.sort = params.sort === 'date_asc' ? 'RD asc' : params.sort === 'date_desc' ? 'RD desc' : 'score desc';
    }

    if (params.dateFrom) queryParams.df = params.dateFrom;
    if (params.dateTo) queryParams.dt = params.dateTo;

    const response = await this.client.madridGet<{
      response?: {
        numFound?: number;
        start?: number;
        docs?: unknown[];
      };
      results?: unknown[];
      total?: number;
      facet_counts?: Record<string, Record<string, number>>;
    }>('/search', queryParams);

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
      marks: docs.map(this.mapMark),
      facets: Object.keys(facets).length > 0 ? facets : undefined,
    };
  }

  /**
   * Get mark by international registration number
   */
  async getByRegistrationNumber(registrationNumber: string): Promise<MadridMark | null> {
    const cleanNumber = registrationNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.madridGet<{
        mark?: unknown;
        response?: { docs?: unknown[] };
      }>(`/mark/${cleanNumber}`);

      const doc = response.mark || response.response?.docs?.[0];
      if (!doc) return null;

      return this.mapMark(doc);
    } catch {
      return null;
    }
  }

  /**
   * Get mark status and designated country statuses
   */
  async getStatus(registrationNumber: string): Promise<{
    registrationNumber: string;
    status: string;
    statusDate?: string;
    designations: DesignatedCountry[];
  } | null> {
    const cleanNumber = registrationNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.madridGet<{
        status?: string;
        statusDate?: string;
        designations?: Array<{
          country?: string;
          countryCode?: string;
          status?: string;
          statusDate?: string;
          protectionDate?: string;
          refusalDate?: string;
          refusalReason?: string;
        }>;
      }>(`/mark/${cleanNumber}/status`);

      return {
        registrationNumber: cleanNumber,
        status: response.status || '',
        statusDate: response.statusDate,
        designations: (response.designations || []).map(d => ({
          countryCode: d.countryCode || d.country || '',
          countryName: d.country,
          status: d.status || '',
          statusDate: d.statusDate,
          protectionStartDate: d.protectionDate,
          refusalDate: d.refusalDate,
          refusalReason: d.refusalReason,
        })),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get documents (gazette publications, notifications)
   */
  async getDocuments(registrationNumber: string): Promise<MadridDocument[]> {
    const cleanNumber = registrationNumber.replace(/[^0-9]/g, '');

    try {
      const response = await this.client.madridGazetteGet<{
        documents?: Array<{
          id?: string;
          type?: string;
          publicationDate?: string;
        }>;
      }>(`/mark/${cleanNumber}/documents`);

      return (response.documents || []).map(doc => ({
        documentId: doc.id || '',
        documentType: this.mapDocumentType(doc.type),
        publicationDate: doc.publicationDate,
        downloadUrl: `https://www3.wipo.int/madrid/monitor/doc/${cleanNumber}/${doc.id}`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Search marks by holder name
   */
  async searchByHolder(holderName: string, rows = 25): Promise<MadridSearchResponse> {
    return this.search({
      holderName,
      rows,
    });
  }

  /**
   * Search marks by Nice classification
   */
  async searchByNiceClass(niceClass: number | number[], rows = 25): Promise<MadridSearchResponse> {
    return this.search({
      niceClass,
      rows,
    });
  }

  /**
   * Search marks designated in a specific country
   */
  async searchByDesignatedCountry(countryCode: string, rows = 25): Promise<MadridSearchResponse> {
    return this.search({
      designatedCountry: countryCode,
      rows,
    });
  }

  /**
   * Get marks expiring soon
   */
  async getExpiringSoon(days = 90, rows = 25): Promise<MadridSearchResponse> {
    const today = new Date();
    const futureDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    const dateStr = futureDate.toISOString().split('T')[0];

    return this.search({
      query: `ED:[${today.toISOString().split('T')[0]} TO ${dateStr}]`,
      status: 'active',
      rows,
    });
  }

  /**
   * Check mark name availability (basic check)
   */
  async checkAvailability(markName: string, designatedCountry?: string): Promise<{
    available: boolean;
    conflicts: MadridMark[];
  }> {
    const params: MadridSearchParams = {
      markName,
      status: 'active',
      rows: 50,
    };

    if (designatedCountry) {
      params.designatedCountry = designatedCountry;
    }

    const response = await this.search(params);

    // Check for exact or similar matches
    const normalizedSearch = markName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const conflicts = response.marks.filter(mark => {
      const normalizedMark = (mark.markName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedMark === normalizedSearch ||
        normalizedMark.includes(normalizedSearch) ||
        normalizedSearch.includes(normalizedMark);
    });

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }

  /**
   * Get Nice classification details
   */
  async getNiceClassification(classNumber: number): Promise<NiceClassification | null> {
    try {
      const response = await this.client.madridGet<{
        classNumber?: number;
        description?: string;
        goodsServices?: string;
      }>(`/nice/${classNumber}`);

      if (!response.classNumber) return null;

      return {
        classNumber: response.classNumber,
        description: response.description,
        goodsServices: response.goodsServices,
      };
    } catch {
      return null;
    }
  }

  private mapDocumentType(type?: string): MadridDocument['documentType'] {
    if (!type) return 'other';
    const lower = type.toLowerCase();
    if (lower.includes('gazette')) return 'gazette';
    if (lower.includes('notification')) return 'notification';
    if (lower.includes('certificate')) return 'certificate';
    return 'other';
  }

  private mapMark(doc: unknown): MadridMark {
    const d = doc as Record<string, unknown>;
    return {
      registrationNumber: String(d.registrationNumber || d.IRN || d.intRegNum || ''),
      applicationNumber: d.applicationNumber as string | undefined,
      markName: d.markName as string | undefined || d.MN as string | undefined || d.wordMark as string | undefined,
      markType: this.mapMarkType(d.markType as string | undefined || d.MT as string | undefined),
      status: String(d.status || d.ST || ''),
      statusDate: d.statusDate as string | undefined,
      registrationDate: String(d.registrationDate || d.RD || d.intRegDate || ''),
      expiryDate: d.expiryDate as string | undefined || d.ED as string | undefined,
      holder: this.mapHolder(d),
      representative: this.mapRepresentative(d),
      designatedCountries: this.mapDesignatedCountries(d),
      niceClassifications: this.mapNiceClassifications(d),
      viennaClassifications: this.mapViennaClassifications(d),
      goodsServices: String(d.goodsServices || d.GS || d.gsDescription || ''),
      colors: Array.isArray(d.colors) ? d.colors.map(String) : undefined,
      imageUrl: d.imageUrl as string | undefined || d.IMG as string | undefined,
      priorities: this.mapPriorities(d),
    };
  }

  private mapMarkType(type?: string): MadridMark['markType'] {
    if (!type) return undefined;
    const lower = type.toLowerCase();
    if (lower.includes('word')) return 'word';
    if (lower.includes('figurative') || lower.includes('device')) return 'figurative';
    if (lower.includes('combined')) return 'combined';
    if (lower.includes('3d') || lower.includes('three')) return 'three-dimensional';
    if (lower.includes('sound')) return 'sound';
    return 'other';
  }

  private mapHolder(d: Record<string, unknown>): MadridMark['holder'] {
    const holder = d.holder || d.HOL;
    if (typeof holder === 'string') {
      return { name: holder, country: '' };
    }
    const h = (holder || d) as Record<string, unknown>;
    return {
      name: String(h.holderName || h.name || d.holderName || ''),
      address: h.address as string | undefined || d.holderAddress as string | undefined,
      city: h.city as string | undefined || d.holderCity as string | undefined,
      country: String(h.country || h.countryCode || d.holderCountry || d.HOLCO || ''),
      entityType: h.entityType as string | undefined,
    };
  }

  private mapRepresentative(d: Record<string, unknown>): MadridMark['representative'] {
    const rep = d.representative || d.REP;
    if (!rep) return undefined;
    if (typeof rep === 'string') {
      return { name: rep };
    }
    const r = rep as Record<string, unknown>;
    return {
      name: String(r.name || r.representativeName || ''),
      address: r.address as string | undefined,
      country: r.country as string | undefined || r.countryCode as string | undefined,
    };
  }

  private mapDesignatedCountries(d: Record<string, unknown>): DesignatedCountry[] {
    const designations = d.designatedCountries || d.DS || d.designations;
    if (!Array.isArray(designations)) {
      if (typeof designations === 'string') {
        return designations.split(',').map(c => ({
          countryCode: c.trim(),
          status: 'designated',
        }));
      }
      return [];
    }

    return designations.map((ds: unknown) => {
      if (typeof ds === 'string') {
        return { countryCode: ds, status: 'designated' };
      }
      const des = ds as Record<string, unknown>;
      return {
        countryCode: String(des.countryCode || des.country || ''),
        countryName: des.countryName as string | undefined,
        status: String(des.status || 'designated'),
        statusDate: des.statusDate as string | undefined,
        protectionStartDate: des.protectionDate as string | undefined || des.protectionStartDate as string | undefined,
        refusalDate: des.refusalDate as string | undefined,
        refusalReason: des.refusalReason as string | undefined,
      };
    });
  }

  private mapNiceClassifications(d: Record<string, unknown>): NiceClassification[] {
    const classes = d.niceClassifications || d.NC || d.classes;
    if (!Array.isArray(classes)) {
      if (typeof classes === 'string') {
        return classes.split(',').map(c => ({
          classNumber: parseInt(c.trim()) || 0,
        }));
      }
      if (typeof classes === 'number') {
        return [{ classNumber: classes }];
      }
      return [];
    }

    return classes.map((c: unknown) => {
      if (typeof c === 'number') {
        return { classNumber: c };
      }
      if (typeof c === 'string') {
        return { classNumber: parseInt(c) || 0 };
      }
      const cls = c as Record<string, unknown>;
      return {
        classNumber: Number(cls.classNumber || cls.number || 0),
        description: cls.description as string | undefined,
        goodsServices: cls.goodsServices as string | undefined || cls.gs as string | undefined,
      };
    });
  }

  private mapViennaClassifications(d: Record<string, unknown>): MadridMark['viennaClassifications'] {
    const vienna = d.viennaClassifications || d.VC;
    if (!Array.isArray(vienna)) return undefined;

    return vienna.map((v: unknown) => {
      if (typeof v === 'string') {
        return { code: v };
      }
      const vc = v as Record<string, unknown>;
      return {
        code: String(vc.code || vc.viennaCode || ''),
        description: vc.description as string | undefined,
      };
    });
  }

  private mapPriorities(d: Record<string, unknown>): MadridMark['priorities'] {
    const priorities = d.priorities || d.priorityClaims;
    if (!Array.isArray(priorities)) return undefined;

    return priorities.map((p: unknown) => {
      const pri = p as Record<string, unknown>;
      return {
        country: String(pri.country || pri.countryCode || ''),
        applicationNumber: String(pri.applicationNumber || pri.priorityNumber || ''),
        filingDate: String(pri.filingDate || pri.priorityDate || ''),
      };
    });
  }
}
