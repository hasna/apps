import type { PatentsViewClient } from './client';
import type {
  CPCSubgroup,
  CPCSearchResponse,
  CPCGetResponse,
  QueryObject,
  QueryOptions,
  SearchRequest,
} from '../types';
import { DEFAULT_CPC_FIELDS } from '../types';

/**
 * CPC API - Search and retrieve CPC (Cooperative Patent Classification) data
 */
export class CPCApi {
  constructor(private readonly client: PatentsViewClient) {}

  /**
   * Search CPC subgroups with filters
   * @param query - Query object with filters
   * @param fields - Fields to return (defaults to common fields)
   * @param options - Pagination and sorting options
   */
  async search(
    query?: QueryObject,
    fields?: string[],
    options?: QueryOptions
  ): Promise<CPCSearchResponse> {
    const body: SearchRequest = {};

    if (query) {
      body.q = query;
    }

    body.f = fields || DEFAULT_CPC_FIELDS;

    if (options) {
      body.o = options;
    }

    return this.client.post<CPCSearchResponse>('/cpc_subgroup/', body);
  }

  /**
   * Get a single CPC subgroup by ID
   * @param cpcSubgroupId - The CPC subgroup ID (e.g., "G06F3/01")
   * @param fields - Fields to return
   */
  async get(cpcSubgroupId: string, fields?: string[]): Promise<CPCSubgroup | null> {
    const response = await this.client.get<CPCGetResponse>(
      `/cpc_subgroup/${encodeURIComponent(cpcSubgroupId)}/`,
      fields ? { f: fields.join(',') } : undefined
    );
    return response.cpc_subgroups?.[0] || null;
  }

  /**
   * Search CPC by title text
   * @param title - Text to search in CPC titles
   * @param options - Pagination options
   */
  async searchByTitle(title: string, options?: QueryOptions): Promise<CPCSearchResponse> {
    return this.search(
      { cpc_subgroup_title: { _text_any: title } },
      undefined,
      options
    );
  }

  /**
   * Search CPC by section
   * @param sectionId - CPC section ID (e.g., "A", "B", "C", "G", "H")
   * @param options - Pagination options
   */
  async searchBySection(sectionId: string, options?: QueryOptions): Promise<CPCSearchResponse> {
    return this.search(
      { cpc_section_id: { _eq: sectionId.toUpperCase() } },
      [...DEFAULT_CPC_FIELDS, 'cpc_section_title'],
      options
    );
  }

  /**
   * Search CPC by class
   * @param classId - CPC class ID (e.g., "G06")
   * @param options - Pagination options
   */
  async searchByClass(classId: string, options?: QueryOptions): Promise<CPCSearchResponse> {
    return this.search(
      { cpc_class_id: { _eq: classId.toUpperCase() } },
      [...DEFAULT_CPC_FIELDS, 'cpc_class_title'],
      options
    );
  }

  /**
   * Search CPC by subclass
   * @param subclassId - CPC subclass ID (e.g., "G06F")
   * @param options - Pagination options
   */
  async searchBySubclass(subclassId: string, options?: QueryOptions): Promise<CPCSearchResponse> {
    return this.search(
      { cpc_subclass_id: { _eq: subclassId.toUpperCase() } },
      [...DEFAULT_CPC_FIELDS, 'cpc_subclass_title'],
      options
    );
  }

  /**
   * Search CPC by group
   * @param groupId - CPC group ID (e.g., "G06F3/00")
   * @param options - Pagination options
   */
  async searchByGroup(groupId: string, options?: QueryOptions): Promise<CPCSearchResponse> {
    return this.search(
      { cpc_group_id: { _eq: groupId } },
      [...DEFAULT_CPC_FIELDS, 'cpc_group_title'],
      options
    );
  }

  /**
   * Get top CPC subgroups by patent count
   * @param limit - Number of subgroups to return
   */
  async getTopByPatentCount(limit = 25): Promise<CPCSearchResponse> {
    return this.search(
      undefined,
      [...DEFAULT_CPC_FIELDS, 'cpc_num_patents'],
      {
        per_page: limit,
        sort: [{ cpc_num_patents: 'desc' }],
      }
    );
  }

  /**
   * Search CPC subgroups by ID prefix
   * @param prefix - ID prefix (e.g., "G06F" to find all G06F classifications)
   * @param options - Pagination options
   */
  async searchByIdPrefix(prefix: string, options?: QueryOptions): Promise<CPCSearchResponse> {
    return this.search(
      { cpc_subgroup_id: { _begins: prefix.toUpperCase() } },
      undefined,
      options
    );
  }

  /**
   * Get all CPC sections
   * This returns subgroups grouped by their section, useful for understanding the hierarchy
   */
  async getSections(): Promise<CPCSearchResponse> {
    // Search for one representative from each section
    const sections = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Y'];
    const results: CPCSubgroup[] = [];

    for (const section of sections) {
      const response = await this.search(
        { cpc_section_id: { _eq: section } },
        ['cpc_section_id', 'cpc_section_title'],
        { per_page: 1 }
      );
      if (response.cpc_subgroups?.[0]) {
        results.push(response.cpc_subgroups[0]);
      }
    }

    return {
      cpc_subgroups: results,
      count: results.length,
      total_hits: results.length,
    };
  }

  /**
   * CPC Section descriptions for reference
   */
  static readonly CPC_SECTIONS: Record<string, string> = {
    'A': 'Human Necessities',
    'B': 'Performing Operations; Transporting',
    'C': 'Chemistry; Metallurgy',
    'D': 'Textiles; Paper',
    'E': 'Fixed Constructions',
    'F': 'Mechanical Engineering; Lighting; Heating; Weapons; Blasting',
    'G': 'Physics',
    'H': 'Electricity',
    'Y': 'General Tagging of New Technological Developments',
  };
}
