// open-crawl public SDK API
// @hasna/crawl

// Types
export type {
  Crawl,
  CreateCrawlInput,
  CrawlOptions,
  CrawlStatus,
  Page,
  CreatePageInput,
  PageMetadata,
  PageVersion,
  FetchOptions,
  FetchResult,
  ExtractedContent,
  AiExtractionOptions,
  AiProvider,
  CrawlConfig,
  SearchResult,
  SearchOptions,
  ExportFormat,
  BrandingResult,
  BrowserAction,
} from "./types/index.js";

// Database — Crawls
export {
  createCrawl,
  getCrawl,
  listCrawls,
  updateCrawl,
  deleteCrawl,
  getCrawlStats,
} from "./db/crawls.js";

// Database — Pages
export {
  createPage,
  getPage,
  getPageByUrl,
  listPages,
  deletePage,
  searchPages,
  savePageVersion,
  getPageVersions,
} from "./db/pages.js";

// Database — Connection
export { getDb, closeDb } from "./db/database.js";

// Database — PostgreSQL migrations
export { PG_MIGRATIONS } from "./db/pg-migrations.js";

// Database — Storage sync
export {
  STORAGE_TABLES,
  getStorageS3Config,
  getStorageS3Status,
  storageArtifactsDownload,
  storageArtifactsUpload,
  storagePull,
  storagePush,
  storageSync,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  runStorageMigrations,
  getSyncMetaAll,
} from "./db/storage-sync.js";
export type {
  ArtifactSyncResult,
  StorageEnv,
  StorageMode,
  StorageS3Config,
  StorageS3Status,
  SyncMeta,
  SyncResult,
} from "./db/storage-sync.js";

// Package metadata
export { PACKAGE_VERSION } from "./version.js";

// Lib — Config
export { getConfig, setConfig, resetConfig, getConfigPath } from "./lib/config.js";

// Lib — Fetcher
export { fetchPage, RateLimiter } from "./lib/fetcher.js";

// Lib — Extractor
export { extractContent } from "./lib/extractor.js";

// Lib — Robots
export { fetchRobotsTxt } from "./lib/robots.js";

// Lib — Sitemap
export { fetchSitemap } from "./lib/sitemap.js";

// Lib — Diff
export { diffTexts, hasSignificantChange } from "./lib/diff.js";

// Lib — PDF
export { extractPdfText, isPdf } from "./lib/pdf.js";

// Lib — AI
export {
  extractWithAI,
  extractWithPrompt,
  summarizePage,
  classifyPage,
  checkAiProviders,
} from "./lib/ai.js";

// Lib — Export
export { exportCrawl, exportPage } from "./lib/export.js";

// Lib — DOCX
export { extractDocxText, isDocx } from "./lib/docx.js";

// Lib — Branding
export { extractBranding } from "./lib/branding.js";

// Lib — Web Search
export { searchWeb } from "./lib/search-web.js";

// Lib — Crawler (main entry points)
export { crawlUrl, startCrawl, batchCrawl, recrawl } from "./lib/crawler.js";

// Lib — Sandbox (e2b cloud crawling)
export { crawlInSandbox, mapInSandbox, checkE2B } from './lib/sandbox.js';
export type { SandboxCrawlResult, SandboxOptions } from './lib/sandbox.js';
