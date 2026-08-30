import type { Database } from 'bun:sqlite';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';
export type SafetyDecision = 'allow' | 'deny' | 'requires_approval';
export interface SafetyPolicy {
    allowWriteRoots: string[];
    readOnlySourceAccess: boolean;
    network: {
        webSearchEnabled: boolean;
        s3ReadsEnabled: boolean;
        allowedS3Buckets: string[];
    };
    redaction: {
        enabled: boolean;
    };
    approvals: {
        generatedWritesRequireApproval: boolean;
    };
}
export interface SafetyAuditInput {
    event_type: string;
    action: string;
    target_uri?: string | null;
    decision: SafetyDecision | 'redacted' | 'info';
    metadata?: Record<string, unknown>;
    created_at?: string;
}
export interface RedactionFinding {
    type: string;
    severity: 'low' | 'medium' | 'high';
    start: number;
    end: number;
}
export interface RedactionResult {
    text: string;
    findings: RedactionFinding[];
}
export declare function resolveSafetyPolicy(config: KnowledgeConfig, workspace: KnowledgeWorkspace): SafetyPolicy;
export declare function assertWriteAllowed(targetPath: string, policy: SafetyPolicy): void;
export declare function assertS3ReadAllowed(uri: string, policy: SafetyPolicy): void;
export declare function assertWebSearchAllowed(policy: SafetyPolicy): void;
export declare function redactSecrets(text: string, policy?: Pick<SafetyPolicy, 'redaction'>): RedactionResult;
/**
 * Redact every string leaf of a renderable value, preserving structure and
 * non-string leaves. Used so retained-version reads mask credential-shaped
 * values wherever they sit in a snapshot — body, title, url, tags, or metadata
 * string values — not just in the field the sweep happened to clean.
 */
export declare function redactValueTree(value: unknown, policy?: Pick<SafetyPolicy, 'redaction'>): unknown;
/**
 * Render-time redaction for retained version history.
 *
 * The store keeps prior-version snapshots verbatim (purge is the only
 * destructive verb), so a credential-shaped value redacted from the LIVE row
 * can still be re-exposed by a retained read — measured 2026-08-24 when a
 * `knowledge versions --id` probe rendered an openai_api_key-shaped value into
 * a second transcript (incident 731221). This applies the redaction path to
 * every string leaf of each version snapshot (content, title, url, tags,
 * metadata) at the RENDERING boundary: identity fields (version, actor,
 * hashes, bytes) survive untouched and the store's copy is never mutated, so
 * `export` and the API stay raw.
 */
type VersionRenderable = {
    content: string | null;
    title?: string;
    url?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
};
export declare function redactVersionHistory<T extends VersionRenderable>(versions: T[], policy?: Pick<SafetyPolicy, 'redaction'>): T[];
export declare function auditId(input: SafetyAuditInput): string;
export declare function recordAuditEvent(db: Database, input: SafetyAuditInput): string;
export declare function recordRedactionFindings(db: Database, input: {
    source_uri?: string | null;
    run_id?: string | null;
    findings: RedactionFinding[];
    metadata?: Record<string, unknown>;
    created_at?: string;
}): number;
export declare function createApprovalGate(db: Database, input: {
    action: string;
    target_uri?: string | null;
    reason?: string | null;
    approved_by?: string | null;
    metadata?: Record<string, unknown>;
    created_at?: string;
}): {
    id: string;
    status: 'approved';
};
export declare function hasApproval(db: Database, action: string, targetUri?: string | null): boolean;
export declare function approvalStatus(db: Database, policy: SafetyPolicy, action: string, targetUri?: string | null): {
    action: string;
    target_uri: string | null;
    approval_required: boolean;
    approved: boolean;
    decision: SafetyDecision;
};
export {};
