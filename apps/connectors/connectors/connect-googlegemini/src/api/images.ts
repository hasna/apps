import type { GeminiClient } from './client';
import type {
  GeminiModel,
  Content,
  GenerationConfig,
  GenerateContentResponse,
  ImageConfig,
} from '../types';

// Image generation models (Nano Banana)
export type ImageModel =
  | 'gemini-2.5-flash-preview-image-generation'
  | 'gemini-3-pro-image-preview';

export interface ImageGenerationOptions {
  aspectRatio?: ImageConfig['aspectRatio'];
  imageSize?: ImageConfig['imageSize'];
  numberOfImages?: number;
}

export interface GeneratedImage {
  mimeType: string;
  data: string; // base64 encoded
}

/**
 * Image Generation API (Nano Banana)
 */
export class ImagesApi {
  constructor(private client: GeminiClient) {}

  /**
   * Generate images from text prompt
   */
  async generate(
    prompt: string,
    options?: ImageGenerationOptions & { model?: ImageModel }
  ): Promise<GeneratedImage[]> {
    const model = options?.model || 'gemini-2.5-flash-preview-image-generation';

    const generationConfig: GenerationConfig = {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: options?.aspectRatio || '16:9',
        imageSize: options?.imageSize || '2K',
        numberOfImages: options?.numberOfImages || 1,
      },
    };

    const response = await this.client.post<GenerateContentResponse>(
      `/models/${model}:generateContent`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }
    );

    // Extract images from response
    const images: GeneratedImage[] = [];
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          images.push({
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data,
          });
        }
      }
    }

    return images;
  }

  /**
   * Edit an existing image with text instructions
   */
  async edit(
    imageBase64: string,
    imageMimeType: string,
    instruction: string,
    options?: ImageGenerationOptions & { model?: ImageModel }
  ): Promise<GeneratedImage[]> {
    const model = options?.model || 'gemini-2.5-flash-preview-image-generation';

    const generationConfig: GenerationConfig = {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: options?.aspectRatio,
        imageSize: options?.imageSize,
        numberOfImages: options?.numberOfImages || 1,
      },
    };

    const response = await this.client.post<GenerateContentResponse>(
      `/models/${model}:generateContent`,
      {
        contents: [
          {
            parts: [
              { text: instruction },
              {
                inlineData: {
                  mimeType: imageMimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig,
      }
    );

    const images: GeneratedImage[] = [];
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          images.push({
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data,
          });
        }
      }
    }

    return images;
  }

  /**
   * Generate and save images to files
   */
  async generateToFiles(
    prompt: string,
    outputDir: string,
    options?: ImageGenerationOptions & { model?: ImageModel; filenamePrefix?: string }
  ): Promise<string[]> {
    const fs = await import('fs');
    const path = await import('path');

    const images = await this.generate(prompt, options);
    const savedPaths: string[] = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const ext = image.mimeType === 'image/png' ? 'png' : 'jpg';
      const prefix = options?.filenamePrefix || 'generated';
      const filename = `${prefix}_${Date.now()}_${i}.${ext}`;
      const filepath = path.join(outputDir, filename);

      const buffer = Buffer.from(image.data, 'base64');
      fs.writeFileSync(filepath, buffer);
      savedPaths.push(filepath);
    }

    return savedPaths;
  }

  /**
   * Describe an image (vision)
   */
  async describe(
    imageBase64: string,
    imageMimeType: string,
    prompt?: string,
    model?: GeminiModel
  ): Promise<string> {
    const response = await this.client.post<GenerateContentResponse>(
      `/models/${model || 'gemini-2.5-flash'}:generateContent`,
      {
        contents: [
          {
            parts: [
              { text: prompt || 'Describe this image in detail.' },
              {
                inlineData: {
                  mimeType: imageMimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
      }
    );

    return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /**
   * Analyze image from file
   */
  async analyzeFile(
    filePath: string,
    prompt?: string,
    model?: GeminiModel
  ): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');

    const fileContent = fs.readFileSync(filePath);
    const base64 = fileContent.toString('base64');

    // Determine MIME type from extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    return this.describe(base64, mimeType, prompt, model);
  }
}
