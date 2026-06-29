import {
  parseContract,
  SCHEMA_IDS,
  type ProjectPanel,
  type ProjectPanelInput,
  type ResourceKind,
} from '@hasna/contracts';
import { createKnowledgeService, type KnowledgeInventoryResult, type KnowledgeService } from './service';

const SOURCE_PACKAGE = '@hasna/knowledge';

export interface KnowledgeProjectPanelOptions {
  service?: KnowledgeService;
  scope?: string;
  cwd?: string;
  limit?: number;
  storePath?: string;
  includeArchived?: boolean;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 0)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 20)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'project';
}

function compact(value: unknown, max = 180): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function resource(kind: ResourceKind, id: string, name?: string, uri?: string, tags: string[] = []) {
  return {
    kind,
    id,
    name,
    uri: uri && hasUriScheme(uri) ? uri : undefined,
    externalId: id,
    sourcePackage: SOURCE_PACKAGE,
    tags,
  };
}

function latestTimestamp(inventory: KnowledgeInventoryResult): string | undefined {
  const timestamps = [
    ...inventory.items.flatMap((row) => [row.updated_at, row.created_at]),
    ...inventory.sources.flatMap((row) => [row.updated_at, row.created_at]),
    ...inventory.chunks.map((row) => row.created_at),
    ...inventory.wiki_pages.flatMap((row) => [row.updated_at, row.created_at]),
    ...inventory.storage_objects.flatMap((row) => [row.updated_at, row.created_at]),
    ...inventory.runs.flatMap((row) => [row.updated_at, row.created_at]),
    ...inventory.reindex_queue.flatMap((row) => [row.updated_at, row.created_at]),
    ...inventory.sync_conflicts.map((row) => row.created_at),
    ...inventory.approval_gates.flatMap((row) => [row.updated_at, row.created_at]),
  ].map(toTimestamp).filter(Boolean) as string[];

  return timestamps.sort((left, right) => right.localeCompare(left))[0];
}

function freshnessFor(latest: string | undefined): ProjectPanelInput['freshness'] {
  if (!latest) return 'unknown';
  const ageMs = Date.now() - new Date(latest).valueOf();
  if (!Number.isFinite(ageMs)) return 'unknown';
  return ageMs > 1000 * 60 * 60 * 24 * 30 ? 'stale' : 'fresh';
}

function unresolvedCount(inventory: KnowledgeInventoryResult): number {
  const isOpen = (status: unknown) => {
    const value = String(status ?? '').toLowerCase();
    return value !== '' && !['done', 'complete', 'completed', 'resolved', 'succeeded', 'skipped'].includes(value);
  };
  return inventory.reindex_queue.filter((row) => isOpen(row.status)).length
    + inventory.sync_conflicts.filter((row) => isOpen(row.status)).length
    + inventory.approval_gates.filter((row) => isOpen(row.status)).length;
}

function inventoryItems(inventory: KnowledgeInventoryResult, limit: number): ProjectPanelInput['items'] {
  const items: ProjectPanelInput['items'] = [];

  for (const row of inventory.items.slice(0, limit)) {
    items.push({
      id: `item_${row.id}`,
      title: row.title,
      summary: compact(row.content_preview),
      status: row.archived ? 'archived' : 'active',
      priority: 'medium',
      timestamp: toTimestamp(row.updated_at ?? row.created_at),
      resourceRefs: [resource('knowledge', row.id, row.title, `knowledge://item/${encodeURIComponent(row.id)}`, row.tags)],
      evidenceRefs: row.url ? [{ id: `url_${row.id}`, kind: 'url', uri: row.url, summary: 'Source URL for this knowledge item.' }] : [],
      metadata: {
        source: 'legacy_store',
        archived: row.archived,
        tags: row.tags,
      },
    });
  }

  for (const row of inventory.sources.slice(0, Math.max(0, limit - items.length))) {
    const id = asString(row.id, asString(row.uri, 'source'));
    const title = asString(row.title, asString(row.uri, id));
    const uri = asString(row.uri, `knowledge://source/${encodeURIComponent(id)}`);
    items.push({
      id: `source_${id}`,
      title,
      summary: compact(`${asNumber(row.chunks)} chunk(s), ${asNumber(row.revisions)} revision(s)`),
      status: asNumber(row.chunks) > 0 ? 'indexed' : 'source',
      priority: 'medium',
      timestamp: toTimestamp(row.updated_at ?? row.created_at),
      resourceRefs: [resource('document', id, title, uri)],
      evidenceRefs: hasUriScheme(uri) ? [{ id: `source_${id}`, kind: 'url', uri, summary: 'Source reference.' }] : [],
      metadata: {
        source: 'knowledge_db.sources',
        kind: row.kind,
        chunks: asNumber(row.chunks),
        revisions: asNumber(row.revisions),
      },
    });
  }

  for (const row of inventory.chunks.slice(0, Math.max(0, limit - items.length))) {
    const id = asString(row.id, 'chunk');
    const sourceUri = asString(row.source_uri);
    items.push({
      id: `chunk_${id}`,
      title: asString(row.wiki_title, sourceUri ? `Chunk from ${sourceUri}` : `Knowledge chunk ${id}`),
      summary: compact(row.text_preview),
      status: 'chunk',
      priority: 'low',
      timestamp: toTimestamp(row.created_at),
      resourceRefs: [resource('context_pack', id, asString(row.wiki_title, id), `knowledge://chunk/${encodeURIComponent(id)}`)],
      evidenceRefs: sourceUri && hasUriScheme(sourceUri) ? [{ id: `chunk_source_${id}`, kind: 'url', uri: sourceUri, summary: 'Chunk source reference.' }] : [],
      metadata: {
        source: 'knowledge_db.chunks',
        source_uri: sourceUri || undefined,
        token_count: row.token_count,
        ordinal: row.ordinal,
      },
    });
  }

  for (const row of inventory.sync_conflicts.slice(0, Math.max(0, limit - items.length))) {
    const id = asString(row.id, 'sync_conflict');
    items.push({
      id: `sync_conflict_${id}`,
      title: `Sync conflict: ${asString(row.entity_kind, 'entity')}/${asString(row.entity_id, id)}`,
      summary: compact(`Status ${asString(row.status, 'unknown')}; strategy ${asString(row.resolution_strategy, 'none')}.`),
      status: asString(row.status, 'unknown'),
      priority: 'critical',
      timestamp: toTimestamp(row.created_at),
      resourceRefs: [resource('finding', id, 'Knowledge sync conflict', `knowledge://sync-conflict/${encodeURIComponent(id)}`)],
      metadata: {
        source: 'knowledge_db.sync_conflicts',
        local_machine_id: row.local_machine_id,
        remote_machine_id: row.remote_machine_id,
      },
    });
  }

  for (const row of inventory.reindex_queue.slice(0, Math.max(0, limit - items.length))) {
    const id = asString(row.id, 'reindex');
    items.push({
      id: `reindex_${id}`,
      title: `Reindex ${asString(row.kind, 'item')}: ${asString(row.target_id, id)}`,
      summary: compact(row.reason),
      status: asString(row.status, 'unknown'),
      priority: asString(row.status).toLowerCase() === 'failed' ? 'high' : 'medium',
      timestamp: toTimestamp(row.updated_at ?? row.created_at),
      resourceRefs: [resource('action', id, 'Knowledge reindex work item', `knowledge://reindex/${encodeURIComponent(id)}`)],
      metadata: {
        source: 'knowledge_db.reindex_queue',
        attempts: row.attempts,
        source_uri: row.source_uri,
      },
    });
  }

  return items.slice(0, limit);
}

export function createKnowledgeProjectPanel(projectRef: string, options: KnowledgeProjectPanelOptions = {}): ProjectPanel {
  const limit = clampLimit(options.limit);
  const generatedAt = new Date().toISOString();
  const projectId = slugify(projectRef);
  const service = options.service ?? createKnowledgeService({ scope: options.scope ?? 'project', cwd: options.cwd });
  const inventory = service.inventory({
    limit,
    storePath: options.storePath,
    includeArchived: options.includeArchived,
  });
  const latest = latestTimestamp(inventory);
  const freshness = freshnessFor(latest);
  const totalKnowledge = inventory.summary.active_items
    + inventory.summary.sources
    + inventory.summary.chunks
    + inventory.summary.wiki_pages
    + inventory.summary.storage_objects;
  const unresolved = unresolvedCount(inventory);
  const state = totalKnowledge === 0 ? 'empty' : freshness === 'stale' ? 'stale' : 'ready';
  const items = inventoryItems(inventory, limit);

  const draft: ProjectPanelInput = {
    schema: SCHEMA_IDS.projectPanel,
    id: `knowledge_panel_${projectId}`,
    createdAt: generatedAt,
    projectId,
    provider: {
      kind: 'knowledge',
      id: `knowledge_${projectId}`,
      name: 'Knowledge',
      sourcePackage: SOURCE_PACKAGE,
      externalId: inventory.home,
    },
    kind: 'knowledge',
    title: 'Knowledge',
    summary: state === 'empty'
      ? 'No project knowledge items, sources, chunks, or wiki pages are available yet.'
      : `${inventory.summary.active_items} active note(s), ${inventory.summary.sources} source(s), ${inventory.summary.chunks} chunk(s), and ${inventory.summary.wiki_pages} wiki page(s).`,
    state,
    stateReason: state === 'stale' ? 'Latest indexed knowledge activity is older than 30 days.' : undefined,
    generatedAt,
    freshness,
    metrics: [
      { id: 'active_items', label: 'Active notes', value: inventory.summary.active_items, status: inventory.summary.active_items > 0 ? 'good' : 'unknown' },
      { id: 'sources', label: 'Sources', value: inventory.summary.sources, status: inventory.summary.sources > 0 ? 'good' : 'unknown' },
      { id: 'chunks', label: 'Chunks', value: inventory.summary.chunks, status: inventory.summary.chunks > 0 ? 'good' : 'unknown' },
      { id: 'wiki_pages', label: 'Wiki pages', value: inventory.summary.wiki_pages, status: inventory.summary.wiki_pages > 0 ? 'good' : 'unknown' },
      { id: 'artifacts', label: 'Artifacts', value: inventory.summary.storage_objects, status: inventory.summary.storage_objects > 0 ? 'good' : 'unknown' },
      { id: 'vector_entries', label: 'Vector entries', value: inventory.summary.vector_entries, status: inventory.summary.vector_entries > 0 ? 'good' : 'unknown' },
      { id: 'unresolved', label: 'Unresolved', value: unresolved, status: unresolved > 0 ? 'warning' : 'good' },
    ],
    items,
    actions: [
      resource('action', 'knowledge:inventory', 'Inspect knowledge inventory'),
      resource('action', 'knowledge:context-pack', 'Build cited context pack'),
      resource('action', 'knowledge:ingest', 'Ingest project source'),
    ],
    resourceRefs: [
      resource('project', projectId, projectRef, `project://${projectId}`),
      resource('knowledge', `home_${projectId}`, 'Knowledge workspace', `knowledge://workspace/${encodeURIComponent(projectId)}`),
      resource('artifact', `db_${projectId}`, 'Knowledge database', `knowledge://db/${encodeURIComponent(projectId)}`),
    ],
    renderFragment: {
      renderer: 'json_render',
      title: 'Knowledge',
      spec: {
        component: 'project.knowledge.summary',
        metrics: ['active_items', 'sources', 'chunks', 'wiki_pages', 'unresolved'],
        itemLimit: limit,
      },
    },
    metadata: {
      scope: inventory.scope,
      home: inventory.home,
      json_store_exists: inventory.paths.json_store_exists,
      latest_activity_at: latest,
    },
  };

  return parseContract(SCHEMA_IDS.projectPanel, draft);
}

export function formatKnowledgeProjectPanel(panel: ProjectPanel): string {
  const lines = [
    `${panel.title}: ${panel.state}`,
    panel.summary ?? '',
    ...panel.metrics.map((metric) => `${metric.label}: ${metric.value}`),
  ].filter(Boolean);

  if (panel.items.length > 0) {
    lines.push('Items:');
    for (const item of panel.items.slice(0, 10)) {
      lines.push(`- ${item.title}${item.status ? ` [${item.status}]` : ''}`);
      if (item.summary) lines.push(`  ${item.summary}`);
    }
  }

  return lines.join('\n');
}
