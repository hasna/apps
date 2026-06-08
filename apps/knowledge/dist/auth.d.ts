import type { KnowledgeConfig } from './workspace';
export interface KnowledgeAuthConfig {
    api_key: string;
    email?: string;
    org_id?: string;
    org_slug?: string;
    user_id?: string;
    api_url?: string;
    created_at: string;
}
export interface KnowledgeAuthStatus {
    authenticated: boolean;
    source: 'env' | 'file' | 'none';
    api_url: string;
    auth_path: string;
    email: string | null;
    org_id: string | null;
    org_slug: string | null;
    user_id: string | null;
    api_key_present: boolean;
}
export declare const DEFAULT_KNOWLEDGE_API_URL = "https://knowledge.hasna.xyz";
export declare function normalizeKnowledgeApiOrigin(apiUrl: string): string;
export declare function knowledgeAuthPath(env?: Record<string, string | undefined>): string;
export declare function resolveKnowledgeApiUrl(config?: KnowledgeConfig, env?: Record<string, string | undefined>): string;
export declare function getKnowledgeAuth(env?: Record<string, string | undefined>): KnowledgeAuthConfig | null;
export declare function saveKnowledgeAuth(auth: Omit<KnowledgeAuthConfig, 'created_at'> & {
    created_at?: string;
}, env?: Record<string, string | undefined>): KnowledgeAuthConfig;
export declare function clearKnowledgeAuth(env?: Record<string, string | undefined>): boolean;
export declare function getKnowledgeApiKey(env?: Record<string, string | undefined>): {
    apiKey: string | null;
    source: KnowledgeAuthStatus['source'];
};
export declare function knowledgeAuthStatus(config?: KnowledgeConfig, env?: Record<string, string | undefined>): KnowledgeAuthStatus;
