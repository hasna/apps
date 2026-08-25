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
    /**
     * When false and a projectLinksAuthority is present, a project the authority
     * cannot resolve (NOT_FOUND) is a hard error instead of silently falling back
     * to the cwd-derived legacy inventory. The hosted route must pass false: the
     * legacy fallback would emit a panel about the current directory labelled
     * with the requested project's slug. Local authority + local store share a
     * corpus, so the fallback stays honest there and remains the default.
     */
    allowLegacyFallback?: boolean;
}
export declare function createKnowledgeProjectPanel(projectRef: string, options?: KnowledgeProjectPanelOptions): Promise<ProjectPanel>;
export declare function formatKnowledgeProjectPanel(panel: ProjectPanel): string;
