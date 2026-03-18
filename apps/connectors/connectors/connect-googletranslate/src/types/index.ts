export interface GoogleTranslateConfig { apiKey: string; }

export interface GTTranslation { translatedText: string; detectedSourceLanguage?: string; model?: string; }
export interface GTTranslateResponse { data: { translations: GTTranslation[] }; }
export interface GTDetection { language: string; isReliable: boolean; confidence: number; }
export interface GTDetectResponse { data: { detections: GTDetection[][] }; }
export interface GTLanguage { language: string; name: string; }
export interface GTLanguageResponse { data: { languages: GTLanguage[] }; }

export class GoogleTranslateApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GoogleTranslateApiError'; this.statusCode = statusCode; }
}
