import { type KnowledgeSyncConflictResolutionProposal } from './sync';
import type { KnowledgeConfig } from './workspace';
export interface KnowledgeSyncConflictAiProposalOptions {
    dbPath: string;
    id: string;
    config?: KnowledgeConfig;
    env?: Record<string, string | undefined>;
    modelRef?: string;
    fake?: boolean;
    now?: Date;
}
export declare function proposeKnowledgeSyncConflictResolutionWithAi(options: KnowledgeSyncConflictAiProposalOptions): Promise<KnowledgeSyncConflictResolutionProposal>;
