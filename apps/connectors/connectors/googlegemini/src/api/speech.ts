import type { GeminiClient } from './client';
import type {
  GeminiModel,
  VoiceName,
  GenerationConfig,
  GenerateContentResponse,
  SpeechConfig,
} from '../types';

export type TTSModel = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts';

export interface TTSOptions {
  model?: TTSModel;
  voice?: VoiceName;
  multiSpeaker?: { speaker: string; voice: VoiceName }[];
}

export interface GeneratedAudio {
  mimeType: string;
  data: string; // base64 encoded PCM
  sampleRate: number;
}

/**
 * Text-to-Speech API
 */
export class SpeechApi {
  constructor(private client: GeminiClient) {}

  /**
   * Available voices
   */
  readonly voices: VoiceName[] = [
    'Kore',
    'Puck',
    'Charon',
    'Zephyr',
    'Fenrir',
    'Leda',
    'Enceladus',
    'Aoede',
    'Callirrhoe',
    'Autonoe',
    'Aitne',
    'Elara',
    'Iocaste',
    'Umbriel',
    'Algieba',
    'Despina',
    'Erinome',
    'Algenib',
    'Rasalgethi',
    'Laomedeia',
    'Achernar',
    'Alnilam',
    'Schedar',
    'Gacrux',
    'Pulcherrima',
    'Achird',
    'Zubenelgenubi',
    'Vindemiatrix',
    'Sadachbia',
    'Sadaltager',
  ];

  /**
   * Generate speech from text
   */
  async generate(text: string, options?: TTSOptions): Promise<GeneratedAudio> {
    const model = options?.model || 'gemini-2.5-flash-preview-tts';

    let speechConfig: SpeechConfig;

    if (options?.multiSpeaker && options.multiSpeaker.length > 0) {
      // Multi-speaker configuration
      speechConfig = {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: options.multiSpeaker.map((s) => ({
            speaker: s.speaker,
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: s.voice,
              },
            },
          })),
        },
      };
    } else {
      // Single speaker configuration
      speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: options?.voice || 'Kore',
          },
        },
      };
    }

    const generationConfig: GenerationConfig = {
      responseModalities: ['AUDIO'],
      speechConfig,
    };

    const response = await this.client.post<GenerateContentResponse>(
      `/models/${model}:generateContent`,
      {
        contents: [{ parts: [{ text }] }],
        generationConfig,
      }
    );

    // Extract audio from response
    const audioPart = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.mimeType?.startsWith('audio/')
    );

    if (!audioPart?.inlineData) {
      throw new Error('No audio data in response');
    }

    return {
      mimeType: audioPart.inlineData.mimeType,
      data: audioPart.inlineData.data,
      sampleRate: 24000, // Gemini TTS outputs 24kHz
    };
  }

  /**
   * Generate speech and save to WAV file
   */
  async generateToFile(
    text: string,
    outputPath: string,
    options?: TTSOptions
  ): Promise<string> {
    const fs = await import('fs');

    const audio = await this.generate(text, options);

    // Convert PCM to WAV
    const pcmData = Buffer.from(audio.data, 'base64');
    const wavBuffer = this.pcmToWav(pcmData, audio.sampleRate);

    fs.writeFileSync(outputPath, wavBuffer);
    return outputPath;
  }

  /**
   * Convert PCM data to WAV format
   */
  private pcmToWav(pcmData: Buffer, sampleRate: number): Buffer {
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;

    // WAV header is 44 bytes
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmData.length, 4); // File size - 8
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([header, pcmData]);
  }

  /**
   * Get available voices
   */
  getVoices(): VoiceName[] {
    return this.voices;
  }

  /**
   * Get available TTS models
   */
  getModels(): TTSModel[] {
    return ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];
  }
}
