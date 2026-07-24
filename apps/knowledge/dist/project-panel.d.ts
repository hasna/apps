import { type ProjectPanel } from '@hasna/contracts';
import { type KnowledgeService } from './service';
export interface KnowledgeProjectPanelOptions {
    service?: KnowledgeService;
    scope?: string;
    cwd?: string;
    limit?: number;
    storePath?: string;
    includeArchived?: boolean;
}
export declare function createKnowledgeProjectPanel(projectRef: string, options?: KnowledgeProjectPanelOptions): Promise<ProjectPanel>;
export declare function formatKnowledgeProjectPanel(panel: ProjectPanel): string;
