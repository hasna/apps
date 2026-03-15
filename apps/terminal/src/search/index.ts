// Smart search — unified entry point for file + content search

export { searchFiles } from "./file-search.js";
export type { FileSearchResult } from "./file-search.js";
export { searchContent } from "./content-search.js";
export type { ContentSearchResult, ContentFileMatch, ContentMatch } from "./content-search.js";
export { DEFAULT_EXCLUDE_DIRS, SOURCE_EXTENSIONS, isSourceFile, isExcludedDir, relevanceScore } from "./filters.js";
