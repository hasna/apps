import type { GeminiClient } from './client';
import type {
  VeoModel,
  VideoGenerationRequest,
  VideoGenerationInstance,
  VideoGenerationParameters,
  VideoGenerationOperation,
  GeneratedVideo,
} from '../types';

export interface VideoGenerationOptions {
  model?: VeoModel;
  negativePrompt?: string;
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p' | '4k';
  durationSeconds?: 4 | 6 | 8;
  personGeneration?: 'dont_allow' | 'allow_adult' | 'allow_all';
  generateAudio?: boolean;
  enhancePrompt?: boolean;
}

/**
 * Video Generation API (Veo)
 */
export class VideoApi {
  constructor(private client: GeminiClient) {}

  /**
   * Generate video from text prompt
   */
  async generate(
    prompt: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationOperation> {
    const model = options?.model || 'veo-3.1-generate-preview';

    const instance: VideoGenerationInstance = {
      prompt,
      negativePrompt: options?.negativePrompt,
    };

    const parameters: VideoGenerationParameters = {
      aspectRatio: options?.aspectRatio || '16:9',
      resolution: options?.resolution || '720p',
      durationSeconds: options?.durationSeconds || 8,
      personGeneration: options?.personGeneration,
      generateAudio: options?.generateAudio,
      enhancePrompt: options?.enhancePrompt,
    };

    return this.client.post<VideoGenerationOperation>(
      `/models/${model}:predictLongRunning`,
      {
        instances: [instance],
        parameters,
      }
    );
  }

  /**
   * Generate video from an image (image-to-video)
   */
  async generateFromImage(
    prompt: string,
    imageBase64: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationOperation> {
    const model = options?.model || 'veo-3.1-generate-preview';

    const instance: VideoGenerationInstance = {
      prompt,
      negativePrompt: options?.negativePrompt,
      image: {
        bytesBase64Encoded: imageBase64,
      },
    };

    const parameters: VideoGenerationParameters = {
      aspectRatio: options?.aspectRatio || '16:9',
      resolution: options?.resolution || '720p',
      durationSeconds: options?.durationSeconds || 8,
      personGeneration: options?.personGeneration,
      generateAudio: options?.generateAudio,
      enhancePrompt: options?.enhancePrompt,
    };

    return this.client.post<VideoGenerationOperation>(
      `/models/${model}:predictLongRunning`,
      {
        instances: [instance],
        parameters,
      }
    );
  }

  /**
   * Generate video with first and last frame
   */
  async generateWithFrames(
    prompt: string,
    firstFrameBase64: string,
    lastFrameBase64: string,
    options?: VideoGenerationOptions
  ): Promise<VideoGenerationOperation> {
    const model = options?.model || 'veo-3.1-generate-preview';

    const instance: VideoGenerationInstance = {
      prompt,
      negativePrompt: options?.negativePrompt,
      image: {
        bytesBase64Encoded: firstFrameBase64,
      },
      lastFrame: {
        bytesBase64Encoded: lastFrameBase64,
      },
    };

    const parameters: VideoGenerationParameters = {
      aspectRatio: options?.aspectRatio || '16:9',
      resolution: options?.resolution || '720p',
      durationSeconds: options?.durationSeconds || 8,
      personGeneration: options?.personGeneration,
      generateAudio: options?.generateAudio,
      enhancePrompt: options?.enhancePrompt,
    };

    return this.client.post<VideoGenerationOperation>(
      `/models/${model}:predictLongRunning`,
      {
        instances: [instance],
        parameters,
      }
    );
  }

  /**
   * Get operation status
   */
  async getOperation(operationName: string): Promise<VideoGenerationOperation> {
    // Operation name format: operations/xxx
    const name = operationName.startsWith('operations/')
      ? operationName
      : `operations/${operationName}`;

    return this.client.get<VideoGenerationOperation>(`/${name}`);
  }

  /**
   * Poll operation until complete
   */
  async waitForCompletion(
    operationName: string,
    pollInterval = 10000,
    maxWait = 600000
  ): Promise<VideoGenerationOperation> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const operation = await this.getOperation(operationName);

      if (operation.done) {
        if (operation.error) {
          throw new Error(`Video generation failed: ${operation.error.message}`);
        }
        return operation;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Video generation timed out');
  }

  /**
   * Generate video and wait for result
   */
  async generateAndWait(
    prompt: string,
    options?: VideoGenerationOptions & { pollInterval?: number; maxWait?: number }
  ): Promise<GeneratedVideo | null> {
    const operation = await this.generate(prompt, options);

    const completed = await this.waitForCompletion(
      operation.name,
      options?.pollInterval,
      options?.maxWait
    );

    return completed.response?.generatedVideos?.[0] || null;
  }

  /**
   * Generate video and save to file
   */
  async generateToFile(
    prompt: string,
    outputPath: string,
    options?: VideoGenerationOptions & { pollInterval?: number; maxWait?: number }
  ): Promise<string> {
    const fs = await import('fs');

    const video = await this.generateAndWait(prompt, options);

    if (!video?.video?.bytesBase64Encoded) {
      throw new Error('No video data in response');
    }

    const buffer = Buffer.from(video.video.bytesBase64Encoded, 'base64');
    fs.writeFileSync(outputPath, buffer);

    return outputPath;
  }

  /**
   * List available Veo models
   */
  getAvailableModels(): VeoModel[] {
    return [
      'veo-3.1-generate-preview',
      'veo-3.1-fast-generate-preview',
      'veo-2.0-generate-001',
    ];
  }
}
