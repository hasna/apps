import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";
import { hasReadyRoot, scheduleAutoRefreshStaleRoots } from "../local/indexer.js";
import { searchFilePaths } from "../local/query.js";

export class FilesProvider implements SearchProvider {
  name = "files" as const;
  displayName = "Local Files";

  isConfigured(): boolean {
    return hasReadyRoot();
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    scheduleAutoRefreshStaleRoots();
    const hits = searchFilePaths(query, { limit: options?.limit ?? 10 });

    return hits.map((hit) => ({
      title: hit.name,
      url: `file://${hit.absPath}`,
      snippet: hit.absPath,
      score: hit.score,
      publishedAt: new Date(hit.mtimeMs).toISOString(),
      metadata: {
        root: hit.rootName,
        relPath: hit.relPath,
        dir: hit.dir,
        ext: hit.ext,
        size: hit.size,
        isBinary: hit.isBinary,
      },
    }));
  }
}
