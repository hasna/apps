export type OutputFormat = 'json' | 'pretty' | 'table';

export interface ProteinSearchOptions {
  query: string;
  size?: number;
  from?: number;
  fields?: string;
}

export interface ProteomeSearchOptions {
  query: string;
  size?: number;
  from?: number;
}

export interface ProteinSummary {
  accession: string;
  id: string;
  entryType: string;
  proteinName: string;
  organism: string;
  geneNames: string[];
}

export interface ProteinSearchResult {
  results: ProteinSummary[];
  total: number;
}

export interface ProteinEntry {
  accession: string;
  id: string;
  entryType: string;
  proteinName: string;
  organism: {
    scientificName: string;
    commonName?: string;
    taxonId: number;
  };
  geneNames: string[];
  sequence?: {
    value: string;
    length: number;
  };
  raw: Record<string, unknown>;
}

export interface ProteomeSummary {
  id: string;
  description: string;
  scientificName: string;
  commonName?: string;
  taxonId: number;
  proteomeType: string;
  modified: string;
}

export interface ProteomeSearchResult {
  results: ProteomeSummary[];
  total: number;
}

export class UniProtApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'UniProtApiError';
  }
}
