import { type GeneratedArtifactProvenance, type KnowledgeProvenance } from './provenance';
export declare const KNOWLEDGE_ANSWER_PURPOSE = "knowledge_answer";
export declare const KNOWLEDGE_INDEX_PURPOSE = "knowledge_index";
export type AccessProvenance = KnowledgeProvenance | GeneratedArtifactProvenance | null;
export interface SourceAccessDecision {
    allowed: boolean;
    code: string;
    message: string;
}
export declare function parseJsonObject(value: string | null | undefined): Record<string, unknown>;
export declare function sourceAccessDecision(permissions: Record<string, unknown>, purpose: string): SourceAccessDecision;
export declare function metadataIsStale(metadata: Record<string, unknown>): boolean;
export declare function provenanceIsStale(provenance: AccessProvenance): boolean;
export declare function provenanceSourceRefs(provenance: AccessProvenance): string[];
export declare function sourceUriCandidates(ref: string): string[];
