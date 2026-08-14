import type { Database } from 'bun:sqlite';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';
export type SafetyDecision = 'allow' | 'deny' | 'requires_approval';
export interface SafetyPolicy {
    mode: 'local' | 'hosted';
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
