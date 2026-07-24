import type {
  CompareEntitiesRequest,
  DetectLanguageRequest,
  ExtractTextRequest,
  JsonObject,
  ParseRequest,
  SimilarityRequest,
  TisaneResponse,
  TransformRequest,
} from '../types';
import type { TisaneClient } from './client';

export class NlpApi {
  constructor(private readonly client: TisaneClient) {}

  listLanguages(): Promise<TisaneResponse> {
    return this.client.get<TisaneResponse>('/languages');
  }

  parse(body: ParseRequest | JsonObject): Promise<TisaneResponse> {
    return this.client.post<TisaneResponse>('/parse', body);
  }

  extractText(body: ExtractTextRequest | JsonObject): Promise<TisaneResponse> {
    return this.client.post<TisaneResponse>('/helper/extract_text', body);
  }

  compareEntities(body: CompareEntitiesRequest | JsonObject): Promise<TisaneResponse> {
    return this.client.post<TisaneResponse>('/compare/entities', body);
  }

  similarity(body: SimilarityRequest | JsonObject): Promise<TisaneResponse> {
    return this.client.post<TisaneResponse>('/similarity', body);
  }

  detectLanguage(body: DetectLanguageRequest | JsonObject): Promise<TisaneResponse> {
    return this.client.post<TisaneResponse>('/detectLanguage', body);
  }

  transform(body: TransformRequest | JsonObject): Promise<TisaneResponse> {
    return this.client.post<TisaneResponse>('/transform', body);
  }
}
