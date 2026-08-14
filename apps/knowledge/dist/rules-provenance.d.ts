import { type ManifestIngestResult } from './manifest-ingest';
import { type RedactionFinding, type SafetyPolicy } from './safety';
export type RulesProvenanceSourceFamily = 'rule_doc' | 'codewith' | 'claude' | 'codex' | 'opencode' | 'prompt' | 'plan' | 'legacy_json';
export type RulesProvenanceRedactionStatus = 'clean' | 'redacted' | 'refused';
export interface RulesProvenancePrecedence {
    rank: number;
    label: string;
}
export interface RulesProvenanceCitation {
    source_ref: string;
    source_path: string | null;
    line_start: number;
    line_end: number;
    content_hash: string;
}
export interface RulesProvenanceRecord {
    source_family: RulesProvenanceSourceFamily;
    title: string;
    source_path: string | null;
    source_path_ref: string;
    source_ref: string;
    owner: string;
    scope: string;
    precedence: RulesProvenancePrecedence;
    source_hash: string;
    content_hash: string;
    discovered_at: string;
    tags: string[];
    redaction_status: RulesProvenanceRedactionStatus;
    redactions: Array<Pick<RedactionFinding, 'type' | 'severity'>>;
    citations: RulesProvenanceCitation[];
    bytes: number;
    line_count: number;
    importable: boolean;
    skipped_reason: string | null;
    preview: string | null;
    legacy_json_id?: string;
}
export interface RulesProvenanceSkippedSource {
    source_family: RulesProvenanceSourceFamily;
    source_path: string;
    reason: string;
}
export interface RulesProvenanceImportOptions {
    root?: string;
    scope?: string;
    owner?: string;
    dryRun?: boolean;
    deprecateLegacy?: boolean;
    includeLegacy?: boolean;
    legacyStorePath?: string;
    dbPath?: string;
    safetyPolicy?: SafetyPolicy;
    now?: Date;
    maxItems?: number;
    limit?: number;
    maxBytesPerFile?: number;
}
export interface RulesProvenanceImportResult {
    ok: boolean;
    workflow: 'global-rules-provenance-import';
    dry_run: boolean;
    writes_performed: boolean;
    root: string;
    scope: string;
    owner: string;
    discovered_at: string;
    max_items: number;
    evidence_limit: number;
    records_seen: number;
    records_importable: number;
    records_refused: number;
    records_skipped: number;
    evidence_truncated: boolean;
    skipped_truncated: boolean;
    evidence: RulesProvenanceRecord[];
    skipped: RulesProvenanceSkippedSource[];
    import_result: ManifestIngestResult | null;
    legacy: {
        store_path: string | null;
        candidates: number;
        promoted: number;
        deprecated: number;
        data_loss: false;
    };
    message: string;
}
export declare function importRulesProvenance(options?: RulesProvenanceImportOptions): Promise<RulesProvenanceImportResult>;
