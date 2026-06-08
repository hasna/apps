import type { ArtifactStore } from './artifact-store';
import {
  artifactKindForKey,
  hashArtifactBody,
  type GeneratedStorageObject,
} from './storage-contract';

export interface WikiLayoutInitResult {
  schema_key: string;
  root_index_key: string;
  wiki_readme_key: string;
  log_key: string;
  artifacts: GeneratedStorageObject[];
  written: string[];
}

function todayParts(now: Date): { year: string; month: string; day: string } {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return { year, month, day };
}

export function agentSchemaTemplate(): string {
  return `# Knowledge Agent Schema v1

## Source Rules

- Treat open-files source references as the preferred source of truth.
- Do not copy raw source files into open-knowledge.
- Cite every durable fact with a source URI, revision/hash when available, and optional span.
- Mark uncertainty explicitly when sources disagree or are incomplete.

## Wiki Rules

- Write generated knowledge as Markdown pages under wiki/.
- Keep root indexes small; use topic, team, project, and machine-readable shards for scale.
- Preserve backlinks between related pages and decisions.
- Prefer updating existing pages over creating near-duplicates.

## Query Rules

- Search wiki pages first, then source chunks, then deeper read-only source refs.
- Use web search only when requested or when current external context is required.
- File useful answers back into the wiki only after approval or approved auto-write mode.

## Lint Rules

- Flag stale pages, missing citations, contradictions, orphan pages, duplicate pages, and unresolved source refs.
`;
}

export function rootIndexTemplate(): string {
  return `# Knowledge Index

This is a compact orientation index for agents. It is not the full search index.

## Shards

- wiki/
- indexes/
- schemas/
- logs/

## Source Ownership

Raw source files are resolved through open-files. This app stores source refs,
citations, chunks, generated wiki artifacts, indexes, and run records.
`;
}

export function wikiReadmeTemplate(): string {
  return `# Wiki

Generated durable knowledge pages live here.

Pages should be concise, cited, and organized for both humans and agents.
`;
}

export async function initializeWikiLayout(store: ArtifactStore, now = new Date()): Promise<WikiLayoutInitResult> {
  const { year, month, day } = todayParts(now);
  const schemaKey = 'schemas/v1.md';
  const rootIndexKey = 'indexes/root.md';
  const wikiReadmeKey = 'wiki/README.md';
  const logKey = `logs/${year}/${month}/${day}.jsonl`;
  const event = {
    ts: now.toISOString(),
    event: 'wiki_layout_initialized',
    schema_key: schemaKey,
    root_index_key: rootIndexKey,
    wiki_readme_key: wikiReadmeKey,
  };

  const entries = [
    { key: schemaKey, body: agentSchemaTemplate(), content_type: 'text/markdown' },
    { key: rootIndexKey, body: rootIndexTemplate(), content_type: 'text/markdown' },
    { key: wikiReadmeKey, body: wikiReadmeTemplate(), content_type: 'text/markdown' },
    { key: logKey, body: `${JSON.stringify(event)}\n`, content_type: 'application/x-ndjson' },
  ];

  const artifacts = await Promise.all(entries.map(async (entry) => {
    const result = await store.put(entry);
    return {
      key: result.key,
      uri: result.uri,
      kind: artifactKindForKey(entry.key),
      content_type: entry.content_type,
      ...hashArtifactBody(entry.body),
    };
  }));
  return {
    schema_key: schemaKey,
    root_index_key: rootIndexKey,
    wiki_readme_key: wikiReadmeKey,
    log_key: logKey,
    artifacts,
    written: [schemaKey, rootIndexKey, wikiReadmeKey, logKey],
  };
}
