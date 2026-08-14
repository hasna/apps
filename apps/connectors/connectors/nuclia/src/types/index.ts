export interface NucliaConfig { serviceToken: string; zone: string; kbId: string; }

export interface NucliaResource { id: string; slug: string; title: string; summary: string; icon: string; metadata: Record<string, unknown>; created: string; modified: string; }
export interface NucliaResourceList { resources: NucliaResource[]; pagination: { page: number; size: number; last: boolean }; }
export interface NucliaSearchResult { resources: { id: string; title: string; summary: string; score: number }[]; paragraphs: { id: string; text: string; score: number; resource_id: string }[]; fulltext: { id: string; text: string; score: number }[]; }
export interface NucliaLabel { labelset: string; label: string; }
export interface NucliaLabelSet { id: string; title: string; color: string; labels: { title: string; related: string }[]; }

export class NucliaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'NucliaApiError'; this.statusCode = statusCode; }
}
