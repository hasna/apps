import type { TinesClient } from './client';
import type { TinesAnnotation } from '../types';

export class AnnotationsApi {
  constructor(private readonly client: TinesClient) {}

  list(storyId: number): Promise<TinesAnnotation[]> {
    return this.client.request<TinesAnnotation[]>('/annotations', {
      params: { story_id: storyId },
    });
  }
}
