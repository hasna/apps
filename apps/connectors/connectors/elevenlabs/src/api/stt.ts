import type { ElevenLabsClient } from './client';
import type { STTRequest, STTResponse, STTModelId } from '../types';

/**
 * Speech-to-Text API module
 * Transcribe audio to text using Scribe models
 */
export class STTApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * Transcribe audio file to text
   */
  async transcribe(
    audioFile: File | Blob,
    options?: {
      modelId?: STTModelId;
      languageCode?: string;
      tagAudioEvents?: boolean;
      numSpeakers?: number;
      timestampsGranularity?: 'word' | 'character' | 'segment';
      diarize?: boolean;
    }
  ): Promise<STTResponse> {
    const formData = new FormData();
    formData.append('file', audioFile);

    if (options?.modelId) {
      formData.append('model_id', options.modelId);
    }
    if (options?.languageCode) {
      formData.append('language_code', options.languageCode);
    }
    if (options?.tagAudioEvents !== undefined) {
      formData.append('tag_audio_events', String(options.tagAudioEvents));
    }
    if (options?.numSpeakers !== undefined) {
      formData.append('num_speakers', String(options.numSpeakers));
    }
    if (options?.timestampsGranularity) {
      formData.append('timestamps_granularity', options.timestampsGranularity);
    }
    if (options?.diarize !== undefined) {
      formData.append('diarize', String(options.diarize));
    }

    return this.client.uploadFile<STTResponse>('/v1/speech-to-text', formData);
  }

  /**
   * Transcribe audio from URL
   */
  async transcribeFromUrl(
    audioUrl: string,
    options?: {
      modelId?: STTModelId;
      languageCode?: string;
      tagAudioEvents?: boolean;
      numSpeakers?: number;
      timestampsGranularity?: 'word' | 'character' | 'segment';
      diarize?: boolean;
    }
  ): Promise<STTResponse> {
    // First fetch the audio
    const response = await fetch(audioUrl);
    const blob = await response.blob();

    return this.transcribe(blob, options);
  }

  /**
   * Get available models for STT
   */
  getAvailableModels(): { id: STTModelId; name: string; description: string }[] {
    return [
      {
        id: 'scribe_v2',
        name: 'Scribe v2',
        description: 'Best quality transcription, 90+ languages, speaker diarization',
      },
      {
        id: 'scribe_v2_realtime',
        name: 'Scribe v2 Realtime',
        description: 'Real-time transcription (~150ms latency), 90+ languages',
      },
      {
        id: 'scribe_v1',
        name: 'Scribe v1',
        description: 'Legacy model (use v2 for better results)',
      },
    ];
  }
}
