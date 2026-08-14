import type { ConnectorClient } from './client';
import { bodyFromArgs, encodePathSegment } from './client';
import type {
  IndexJob,
  Library,
  PremiereExport,
  RawRequestOptions,
  SearchResult,
  Sequence,
} from '../types';

export class WideframeApi {
  constructor(private readonly client: ConnectorClient) {}

  listLibraries(
    args: Record<string, unknown> = {},
    headers?: Record<string, string>,
  ): Promise<Library[] | Record<string, unknown>> {
    const query = (args.query as Record<string, string | number | boolean | undefined>) || undefined;
    return this.client.request('/libraries', {
      method: 'GET',
      params: query,
      headers,
    });
  }

  getLibrary(libraryId: string, headers?: Record<string, string>): Promise<Library> {
    return this.client.get(`/libraries/${encodePathSegment(libraryId)}`, undefined);
  }

  createIndexJob(
    libraryId: string,
    args: Record<string, unknown> = {},
    headers?: Record<string, string>,
  ): Promise<IndexJob> {
    return this.client.post(
      `/libraries/${encodePathSegment(libraryId)}/index-jobs`,
      bodyFromArgs(args),
      undefined,
    );
  }

  getIndexJob(jobId: string, headers?: Record<string, string>): Promise<IndexJob> {
    return this.client.get(`/index-jobs/${encodePathSegment(jobId)}`, undefined);
  }

  searchFootage(
    libraryId: string,
    args: Record<string, unknown> = {},
    headers?: Record<string, string>,
  ): Promise<SearchResult> {
    return this.client.post(
      `/libraries/${encodePathSegment(libraryId)}/search`,
      bodyFromArgs(args),
      undefined,
    );
  }

  createSequence(
    args: Record<string, unknown> = {},
    headers?: Record<string, string>,
  ): Promise<Sequence> {
    return this.client.post('/sequences', bodyFromArgs(args), undefined);
  }

  exportPremiereProject(
    sequenceId: string,
    args: Record<string, unknown> = {},
    headers?: Record<string, string>,
  ): Promise<PremiereExport> {
    return this.client.post(
      `/sequences/${encodePathSegment(sequenceId)}/exports/premiere`,
      bodyFromArgs(args),
      undefined,
    );
  }

  rawRequest(options: RawRequestOptions = {}): Promise<unknown> {
    const path = options.path ?? '/libraries';
    const method = options.method ?? 'GET';
    return this.client.request(path, {
      method,
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }
}
