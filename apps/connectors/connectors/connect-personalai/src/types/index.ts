export interface PersonalAIConfig { apiKey: string; }

export interface PAIMessage { text: string; ai_score: number; ai_message: string; }
export interface PAIMemory { id: string; text: string; source_name: string; created_at: string; }
export interface PAIMemoryList { memories: PAIMemory[]; total: number; }
export interface PAIProfile { display_name: string; bio: string; ai_name: string; memory_count: number; }
export interface PAIDomain { id: string; name: string; description: string; domain_type: string; memory_count: number; }

export class PersonalAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PersonalAIApiError'; this.statusCode = statusCode; }
}
