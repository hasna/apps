import { type ProjectPanel } from '@hasna/contracts';
import { type KnowledgeService } from './service';
import { type KnowledgeProjectLinksAuthority } from './project-links';
export interface KnowledgeProjectPanelOptions {
    service?: KnowledgeService;
    projectLinksAuthority?: KnowledgeProjectLinksAuthority;
    scope?: string;
    cwd?: string;
    limit?: number;
    storePath?: string;
    includeArchived?: boolean;
}
export declare function createKnowledgeProjectPanel(projectRef: string, options?: KnowledgeProjectPanelOptions): Promise<ProjectPanel>;
export declare function formatKnowledgeProjectPanel(panel: ProjectPanel): string;
