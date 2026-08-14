import type {
  ProteinSearchOptions,
  ProteinSearchResult,
  ProteinEntry,
  ProteomeSearchOptions,
  ProteomeSearchResult,
  ProteinSummary,
  ProteomeSummary,
} from '../types';
import { UniProtApiError } from '../types';

const BASE_URL = 'https://rest.uniprot.org';

interface UniProtSearchResponse {
  results: Record<string, unknown>[];
  facets?: unknown[];
}

export class UniProtClient {
  private async request<T>(path: string, params?: Record<string, string>): Promise<{ data: T; totalResults?: number }> {
    const url = new URL(path, BASE_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json() as { messages?: Array<{ text?: string }> };
        const message = body.messages?.[0]?.text;
        if (message) detail = message;
      } catch {
        // use statusText
      }
      throw new UniProtApiError(`UniProt API error: ${detail}`, response.status);
    }

    const totalHeader = response.headers.get('X-Total-Results');
    const totalResults = totalHeader ? parseInt(totalHeader, 10) : undefined;
    const data = await response.json() as T;

    return { data, totalResults };
  }

  async searchProteins(options: ProteinSearchOptions): Promise<ProteinSearchResult> {
    const { data, totalResults } = await this.request<UniProtSearchResponse>('/uniprotkb/search', {
      query: options.query,
      size: String(options.size ?? 25),
      from: String(options.from ?? 0),
      format: 'json',
      ...(options.fields ? { fields: options.fields } : {}),
    });

    const results = data.results.map((entry) => this.parseProteinSummary(entry));

    return { results, total: totalResults ?? results.length };
  }

  async getProtein(accession: string): Promise<ProteinEntry> {
    const cleanAccession = accession.trim().toUpperCase();
    const { data: entry } = await this.request<Record<string, unknown>>(
      `/uniprotkb/${encodeURIComponent(cleanAccession)}.json`,
    );

    return this.parseProteinEntry(entry);
  }

  async searchProteomes(options: ProteomeSearchOptions): Promise<ProteomeSearchResult> {
    const { data, totalResults } = await this.request<UniProtSearchResponse>('/proteomes/search', {
      query: options.query,
      size: String(options.size ?? 25),
      from: String(options.from ?? 0),
      format: 'json',
    });

    const results = data.results.map((entry) => this.parseProteomeSummary(entry));

    return { results, total: totalResults ?? results.length };
  }

  private parseProteinSummary(entry: Record<string, unknown>): ProteinSummary {
    const accession = String(entry.primaryAccession ?? '');
    const id = String(entry.uniProtkbId ?? '');
    const entryType = String(entry.entryType ?? '');

    const proteinDesc = entry.proteinDescription as Record<string, unknown> | undefined;
    const recommendedName = proteinDesc?.recommendedName as Record<string, unknown> | undefined;
    const fullName = recommendedName?.fullName as { value?: string } | undefined;
    const proteinName = fullName?.value ?? id;

    const organism = entry.organism as { scientificName?: string } | undefined;
    const genes = (entry.genes as Array<{ geneName?: { value?: string } }> | undefined) ?? [];
    const geneNames = genes
      .map((g) => g.geneName?.value)
      .filter((name): name is string => Boolean(name));

    return {
      accession,
      id,
      entryType,
      proteinName,
      organism: organism?.scientificName ?? 'Unknown',
      geneNames,
    };
  }

  private parseProteinEntry(entry: Record<string, unknown>): ProteinEntry {
    const summary = this.parseProteinSummary(entry);
    const organism = entry.organism as {
      scientificName?: string;
      commonName?: string;
      taxonId?: number;
    } | undefined;

    const sequence = entry.sequence as { value?: string; length?: number } | undefined;

    return {
      ...summary,
      organism: {
        scientificName: organism?.scientificName ?? 'Unknown',
        commonName: organism?.commonName,
        taxonId: organism?.taxonId ?? 0,
      },
      sequence: sequence?.value
        ? { value: sequence.value, length: sequence.length ?? sequence.value.length }
        : undefined,
      raw: entry,
    };
  }

  private parseProteomeSummary(entry: Record<string, unknown>): ProteomeSummary {
    const taxonomy = entry.taxonomy as {
      scientificName?: string;
      commonName?: string;
      taxonId?: number;
    } | undefined;

    return {
      id: String(entry.id ?? ''),
      description: String(entry.description ?? '').slice(0, 200),
      scientificName: taxonomy?.scientificName ?? 'Unknown',
      commonName: taxonomy?.commonName,
      taxonId: taxonomy?.taxonId ?? 0,
      proteomeType: String(entry.proteomeType ?? ''),
      modified: String(entry.modified ?? ''),
    };
  }
}
