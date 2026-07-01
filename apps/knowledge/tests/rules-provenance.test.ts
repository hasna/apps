import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKnowledgeDbStats, openKnowledgeDb } from '../src/knowledge-db';
import { importRulesProvenance } from '../src/rules-provenance';
import { redactSecrets } from '../src/safety';
import { createKnowledgeService } from '../src/service';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

function runCli(args: string[], cwd: string) {
  const result = spawnSync('bun', [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
  };
}

function syntheticBareTokens(): string[] {
  return [
    ['ghp', '_', 'A'.repeat(36)].join(''),
    ['gho', '_', 'B'.repeat(36)].join(''),
    ['github', '_pat_', 'C'.repeat(36)].join(''),
    ['npm', '_', 'D'.repeat(36)].join(''),
    ['ctx7sk', '-', 'E'.repeat(24)].join(''),
    ['xai', '-', 'F'.repeat(24)].join(''),
    ['AI', 'za', 'G'.repeat(35)].join(''),
    ['AK', 'IA', 'H'.repeat(16)].join(''),
    ['sk', '-proj-', 'I'.repeat(32)].join(''),
    ['sk', '-ant-', 'J'.repeat(32)].join(''),
  ];
}

function syntheticBareTokenText(): string {
  return syntheticBareTokens().map((value, index) => `case-${index}: ${value}`).join('\n');
}

function expectNoSyntheticBareTokens(value: unknown) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const token of syntheticBareTokens()) {
    expect(serialized).not.toContain(token);
  }
}

function expectNoSyntheticBareTokenBytes(paths: string[]) {
  for (const path of paths.filter((candidate) => existsSync(candidate))) {
    const bytes = readFileSync(path);
    for (const token of syntheticBareTokens()) {
      expect(bytes.includes(Buffer.from(token))).toBe(false);
    }
  }
}

describe('global rules provenance import', () => {
  test('shared safety redactor covers bare token-shaped values', () => {
    const result = redactSecrets(syntheticBareTokenText());

    expect(result.findings.length).toBeGreaterThanOrEqual(syntheticBareTokens().length);
    expectNoSyntheticBareTokens(result.text);
    expect(result.findings.every((finding) => finding.severity === 'high')).toBe(true);
  });

  test('dry-run discovers sources, refuses secret-like content, and writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-rules-dry-run-'));
    mkdirSync(join(dir, '.claude', 'rules'), { recursive: true });
    writeFileSync(join(dir, 'CODEWITH.md'), '# Global Rules\n\nUse source-backed records.');
    const secretLike = ['api', '_key=EXAMPLE_ONLY_REDACTION_SENTINEL'].join('');
    writeFileSync(join(dir, '.claude', 'rules', 'example.md'), `# Do Not Import\n\n${secretLike}`);

    const result = await importRulesProvenance({
      root: dir,
      scope: 'project',
      dryRun: true,
      dbPath: join(dir, '.hasna', 'knowledge', 'knowledge.db'),
      legacyStorePath: join(dir, '.hasna', 'knowledge', 'db.json'),
      now: new Date('2026-07-01T10:00:00.000Z'),
      limit: 10,
    });

    expect(result.dry_run).toBe(true);
    expect(result.writes_performed).toBe(false);
    expect(result.records_seen).toBe(2);
    expect(result.records_importable).toBe(1);
    expect(result.records_refused).toBe(1);
    expect(existsSync(join(dir, '.hasna', 'knowledge', 'knowledge.db'))).toBe(false);

    const clean = result.evidence.find((record) => record.source_path_ref === 'CODEWITH.md');
    expect(clean).toMatchObject({
      owner: 'global-agent-rules-standard',
      scope: 'project',
      redaction_status: 'clean',
      importable: true,
      tags: expect.arrayContaining(['global-rules']),
    });
    expect(clean?.source_ref).toStartWith('file://');
    expect(clean?.source_hash).toStartWith('sha256:');
    expect(clean?.content_hash).toStartWith('sha256:');
    expect(clean?.citations[0]).toMatchObject({ line_start: 1, line_end: 3 });

    const refused = result.evidence.find((record) => record.source_path_ref.endsWith('example.md'));
    expect(refused).toMatchObject({
      redaction_status: 'refused',
      importable: false,
      skipped_reason: 'secret_refused',
      preview: null,
    });
    expect(JSON.stringify(result)).not.toContain('EXAMPLE_ONLY_REDACTION_SENTINEL');
  });

  test('dry-run refuses bare token-shaped content without echoing values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-rules-bare-dry-run-'));
    mkdirSync(join(dir, '.codewith', 'rules'), { recursive: true });
    writeFileSync(join(dir, 'CODEWITH.md'), '# Global Rules\n\nUse source-backed records.');
    writeFileSync(join(dir, '.codewith', 'rules', 'global.md'), `# Neutral Rule\n\n${syntheticBareTokenText()}`);

    const result = await importRulesProvenance({
      root: dir,
      scope: 'project',
      dryRun: true,
      dbPath: join(dir, '.hasna', 'knowledge', 'knowledge.db'),
      legacyStorePath: join(dir, '.hasna', 'knowledge', 'db.json'),
      now: new Date('2026-07-01T10:00:00.000Z'),
      limit: 10,
    });

    expect(result.dry_run).toBe(true);
    expect(result.writes_performed).toBe(false);
    expect(result.records_seen).toBe(2);
    expect(result.records_importable).toBe(1);
    expect(result.records_refused).toBe(1);
    expect(existsSync(join(dir, '.hasna', 'knowledge', 'knowledge.db'))).toBe(false);

    const refused = result.evidence.find((record) => record.source_path_ref === '.codewith/rules/global.md');
    expect(refused).toMatchObject({
      redaction_status: 'refused',
      importable: false,
      skipped_reason: 'secret_refused',
      preview: null,
    });
    expect(refused?.redactions.length).toBeGreaterThanOrEqual(syntheticBareTokens().length);
    expectNoSyntheticBareTokens(result);
  });

  test('apply imports through Knowledge storage and deprecates promoted legacy JSON notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-rules-apply-'));
    mkdirSync(join(dir, '.codewith', 'rules'), { recursive: true });
    writeFileSync(join(dir, '.codewith', 'rules', 'global.md'), '# Codewith Rules\n\nPreserve provenance on imports.');
    const knowledgeHome = join(dir, '.hasna', 'knowledge');
    mkdirSync(knowledgeHome, { recursive: true });
    writeFileSync(join(knowledgeHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_legacy_rules',
        short_id: 'legacy_rules',
        title: 'Legacy agent rules note',
        content: 'Legacy note should be promoted into source-backed storage.',
        url: null,
        tags: ['rules'],
        metadata: {},
        archived: false,
        created_at: '2026-06-30T00:00:00.000Z',
        updated_at: '2026-06-30T00:00:00.000Z',
      }],
    }, null, 2));

    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const result = await service.importRulesProvenance({
      root: dir,
      dryRun: false,
      owner: 'global-agent-rules-standard',
      limit: 10,
    });

    expect(result.dry_run).toBe(false);
    expect(result.import_result?.items_seen).toBe(2);
    expect(result.legacy).toMatchObject({ candidates: 1, promoted: 1, deprecated: 1, data_loss: false });
    const stats = getKnowledgeDbStats(service.workspace.knowledgeDbPath);
    expect(stats.sources).toBe(2);
    expect(stats.chunks).toBe(2);

    const db = openKnowledgeDb(service.workspace.knowledgeDbPath);
    try {
      const rows = db.query<{ uri: string; metadata_json: string }, []>(
        'SELECT uri, metadata_json FROM sources ORDER BY uri',
      ).all();
      expect(rows.some((row) => row.uri.startsWith('file://'))).toBe(true);
      expect(rows.some((row) => row.uri === 'open-files://source/legacy-json/path/k_legacy_rules')).toBe(true);
      for (const row of rows) {
        const metadata = JSON.parse(row.metadata_json);
        expect(typeof metadata.rule_provenance.owner).toBe('string');
        expect(metadata.rule_provenance).toMatchObject({
          source_ref: row.uri,
          redaction_status: 'clean',
        });
        expect(metadata.rule_provenance.citations[0].content_hash).toStartWith('sha256:');
      }
    } finally {
      db.close();
    }

    const legacyStore = JSON.parse(readFileSync(join(knowledgeHome, 'db.json'), 'utf8'));
    expect(legacyStore.items[0].archived).toBe(true);
    expect(legacyStore.items[0].metadata.knowledge_rules_import).toMatchObject({
      status: 'deprecated_after_source_backed_promotion',
      source_ref: 'open-files://source/legacy-json/path/k_legacy_rules',
      data_loss: false,
    });
  });

  test('apply refuses bare token-shaped content before manifest ingestion and DB storage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-rules-bare-apply-'));
    mkdirSync(join(dir, '.codewith', 'rules'), { recursive: true });
    writeFileSync(join(dir, 'CODEWITH.md'), '# Global Rules\n\nUse source-backed records.');
    writeFileSync(join(dir, '.codewith', 'rules', 'global.md'), `# Neutral Rule\n\n${syntheticBareTokenText()}`);
    const dbPath = join(dir, '.hasna', 'knowledge', 'knowledge.db');

    const result = await importRulesProvenance({
      root: dir,
      scope: 'project',
      dryRun: false,
      dbPath,
      legacyStorePath: join(dir, '.hasna', 'knowledge', 'db.json'),
      now: new Date('2026-07-01T10:00:00.000Z'),
      limit: 10,
    });

    expect(result.dry_run).toBe(false);
    expect(result.writes_performed).toBe(true);
    expect(result.records_seen).toBe(2);
    expect(result.records_importable).toBe(1);
    expect(result.records_refused).toBe(1);
    expect(result.import_result?.items_seen).toBe(1);
    expectNoSyntheticBareTokens(result);

    const stats = getKnowledgeDbStats(dbPath);
    expect(stats.sources).toBe(1);
    expect(stats.chunks).toBe(1);

    const db = openKnowledgeDb(dbPath);
    try {
      const rows = db.query<{ text: string; metadata_json: string }, []>(
        'SELECT text, metadata_json FROM chunks',
      ).all();
      expect(rows).toHaveLength(1);
      expectNoSyntheticBareTokens(rows);
    } finally {
      db.close();
    }
    expectNoSyntheticBareTokenBytes([dbPath, `${dbPath}-wal`, `${dbPath}-shm`]);
  });

  test('CLI dry-run emits bounded JSON and does not create a project workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-rules-cli-'));
    writeFileSync(join(dir, 'AGENTS.md'), '# Agent Rules\n\nReturn bounded evidence.');

    const result = runCli([
      'ingest',
      'rules',
      '--workspace',
      dir,
      '--scope',
      'project',
      '--dry-run',
      '--limit',
      '1',
      '--json',
    ], dir);

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.workflow).toBe('global-rules-provenance-import');
    expect(out.dry_run).toBe(true);
    expect(out.writes_performed).toBe(false);
    expect(out.evidence).toHaveLength(1);
    expect(out.evidence_truncated).toBe(false);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);
  });
});
