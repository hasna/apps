import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";
import { hasReadyRoot, scheduleAutoRefreshStaleRoots } from "../local/indexer.js";
import { searchFileContent } from "../local/query.js";

export class ContentProvider implements SearchProvider {
  name = "content" as const;
  displayName = "Local Content";

  isConfigured(): boolean {
    return hasReadyRoot();
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    scheduleAutoRefreshStaleRoots();
    const hits = searchFileContent(query, { limit: options?.limit ?? 10 });

    return hits.map((hit) => ({
      title: hit.name,
      url: `file://${hit.absPath}`,
      snippet: `${hit.relPath}:${hit.line}: ${hit.lineText}`,
      score: hit.score,
      publishedAt: new Date(hit.mtimeMs).toISOString(),
      metadata: {
        root: hit.rootName,
        relPath: hit.relPath,
        dir: hit.dir,
        ext: hit.ext,
        line: hit.line,
        matches: hit.matches,
      },
    }));
  }
}
