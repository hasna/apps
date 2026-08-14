import type { XAIGrokClient } from './client';

export class AudioApi {
  constructor(private readonly client: XAIGrokClient) {}

  createSpeech(body: Record<string, unknown>): Promise<ArrayBuffer> {
    return this.client.postBinary('/audio/speech', body);
  }

  createTranscription(formData: FormData): Promise<unknown> {
    return this.client.post('/audio/transcriptions', formData);
  }

  createTranslation(formData: FormData): Promise<unknown> {
    return this.client.post('/audio/translations', formData);
  }
}
