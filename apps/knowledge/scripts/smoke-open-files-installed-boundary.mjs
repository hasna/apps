#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

function parseArgs(argv) {
  const options = {
    json: false,
    dryRun: false,
    keepTemp: false,
    filesBin: process.env.FILES_BIN || 'files',
    knowledgeBin: process.env.KNOWLEDGE_BIN || 'knowledge',
    evidenceJson: process.env.KNOWLEDGE_OPEN_FILES_SMOKE_EVIDENCE_JSON || null,
    evidenceMd: process.env.KNOWLEDGE_OPEN_FILES_SMOKE_EVIDENCE_MD || null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--keep-temp') options.keepTemp = true;
    else if (arg === '--files-bin') {
      options.filesBin = argv[index + 1];
      index += 1;
    } else if (arg === '--knowledge-bin') {
      options.knowledgeBin = argv[index + 1];
      index += 1;
    } else if (arg === '--evidence-json') {
      options.evidenceJson = argv[index + 1];
      index += 1;
    } else if (arg === '--evidence-md') {
      options.evidenceMd = argv[index + 1];
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: bun scripts/smoke-open-files-installed-boundary.mjs [--json] [--dry-run] [--keep-temp]',
        '       [--files-bin files] [--knowledge-bin knowledge] [--evidence-json <path>] [--evidence-md <path>]',
        '',
        'Runs the installed open-files to open-knowledge source-boundary smoke:',
        '  1. create an isolated open-files data dir and source containing a raw sentinel',
        '  2. use the installed files binary to index, export manifest, doctor, resolve, and extract redacted text',
        '  3. ingest only source refs and redacted extracted text into an isolated knowledge workspace',
        '  4. run knowledge sync doctor, dry-run, push, and follow-up dry-run to a peer workspace',
        '  5. scan both knowledge SQLite stores and artifacts for the raw sentinel and its base64 form',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    ...options,
  });
  const status = result.status ?? 1;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (status !== 0) {
    throw new Error([
      `Command failed (${status}): ${command} ${args.join(' ')}`,
      stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
      stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
    ].filter(Boolean).join('\n'));
  }
  return stdout;
}

function parseJson(label, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${String(error)}\n${raw.slice(0, 1200)}`);
  }
}

function runJson(label, command, args = [], options = {}) {
  return parseJson(label, run(command, args, options));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertNoRaw(value, label, sentinels) {
  for (const sentinel of sentinels) {
    if (value.includes(sentinel)) throw new Error(`${label} contains a raw sentinel.`);
  }
}

function readTextTree(root) {
  if (!existsSync(root)) return '';
  let text = '';
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) text += readTextTree(path);
    else if (stat.isFile()) text += readFileSync(path, 'utf8');
  }
  return text;
}

function dumpSqliteText(dbPath) {
  if (!existsSync(dbPath)) return '';
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all();
    return tables.map((row) => {
      const rows = db.query(`SELECT * FROM ${JSON.stringify(row.name)}`).all();
      return JSON.stringify({ table: row.name, rows });
    }).join('\n');
  } finally {
    db.close();
  }
}

function knowledgeHome(workspace) {
  return join(workspace, '.hasna', 'apps', 'knowledge');
}

function knowledgeDbPath(workspace) {
  return join(knowledgeHome(workspace), 'knowledge.db');
}

function artifactsPath(workspace) {
  return join(knowledgeHome(workspace), 'artifacts');
}

function countRows(dbPath, table) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get();
    return row?.n ?? 0;
  } finally {
    db.close();
  }
}

function tableInserted(result, side) {
  return result?.[side]?.tables?.reduce((sum, table) => sum + (table.inserted || 0), 0) ?? 0;
}

function tableConflicts(result, side) {
  return result?.[side]?.tables?.reduce((sum, table) => sum + (table.conflicts || 0), 0) ?? 0;
}

function dryRunSummary(options) {
  return {
    ok: true,
    dry_run: true,
    files_bin: options.filesBin,
    knowledge_bin: options.knowledgeBin,
    checks: [
      'create isolated open-files source with raw sentinel',
      'run installed files sources/index/manifest/doctor/resolve/extract-text',
      'redact raw sentinel before knowledge ingest',
      'ingest safe open-files manifest into knowledge',
      'resolve source through knowledge local catalog',
      'run sync doctor, dry-run, push, and follow-up dry-run',
      'scan source and peer knowledge SQLite/artifacts for raw sentinel and base64',
    ],
  };
}

function markdownEvidence(summary) {
  return [
    '# Installed Open-Files Boundary Smoke',
    '',
    `- ok: ${summary.ok}`,
    `- files version: ${summary.files_version}`,
    `- knowledge version: ${summary.knowledge_version}`,
    `- source refs: ${summary.boundary.source_refs}`,
    `- chunks source/peer: ${summary.knowledge.source_chunks}/${summary.peer.source_chunks}`,
    `- initial dry-run inserted: ${summary.sync.initial_dry_run_inserted}`,
    `- final dry-run ok: ${summary.sync.final_dry_run_ok}`,
    `- raw sentinel absent from knowledge: ${summary.raw_sentinel_absent_from_knowledge}`,
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
  ].join('\n');
}

function outputSummary(summary, options) {
  if (options.evidenceJson) writeFileSync(options.evidenceJson, `${JSON.stringify(summary, null, 2)}\n`);
  if (options.evidenceMd) writeFileSync(options.evidenceMd, markdownEvidence(summary));
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log([
      `installed open-files boundary smoke: ${summary.ok ? 'ok' : 'failed'}`,
      `files: ${summary.files_version}`,
      `knowledge: ${summary.knowledge_version}`,
      `raw sentinel absent from knowledge: ${summary.raw_sentinel_absent_from_knowledge}`,
    ].join('\n'));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) {
    outputSummary(dryRunSummary(options), options);
    return;
  }

  const root = mkdtempSync(join(tmpdir(), 'knowledge-open-files-installed-boundary-'));
  const filesData = join(root, 'files-data');
  const filesSource = join(root, 'open-files-source');
  const knowledgeSource = join(root, 'knowledge-source');
  const knowledgePeer = join(root, 'knowledge-peer');
  const manifestPath = join(root, 'safe-open-files-manifest.jsonl');
  const rawSentinel = `OPEN_FILES_INSTALLED_BOUNDARY_RAW_${Date.now()}_${sha256(String(Math.random())).slice(0, 16)}`;
  const rawSentinelBase64 = Buffer.from(rawSentinel, 'utf8').toString('base64');
  const allowedExtractedText = 'Installed open-files boundary extracted summary for knowledge sync.';
  const sentinels = [rawSentinel, rawSentinelBase64];

  try {
    mkdirSync(filesData, { recursive: true });
    mkdirSync(filesSource, { recursive: true });
    mkdirSync(knowledgeSource, { recursive: true });
    mkdirSync(knowledgePeer, { recursive: true });

    writeFileSync(join(filesSource, 'boundary-source.md'), [
      '# Installed open-files boundary source',
      allowedExtractedText,
      `Raw sentinel owned by open-files: ${rawSentinel}`,
      '',
    ].join('\n'));

    const filesEnv = {
      ...process.env,
      HASNA_FILES_DATA_DIR: filesData,
      HASNA_FILES_DB_PATH: join(filesData, 'files.db'),
    };
    const knowledgeEnv = { ...process.env };

    const filesVersion = run(options.filesBin, ['--version'], { env: filesEnv }).trim();
    const knowledgeVersion = run(options.knowledgeBin, ['--version'], { env: knowledgeEnv }).trim();

    run(options.filesBin, ['sources', 'add', filesSource, '--name', 'installed-boundary-smoke'], { env: filesEnv });
    run(options.filesBin, ['index'], { env: filesEnv });
    const sources = runJson('files sources list', options.filesBin, ['sources', 'list', '--json'], { env: filesEnv });
    const source = sources.find((entry) => entry.name === 'installed-boundary-smoke');
    if (!source) throw new Error('Installed files did not create the smoke source.');
    const files = runJson('files list', options.filesBin, ['list', '--json'], { env: filesEnv });
    const file = files.find((entry) => entry.name === 'boundary-source.md');
    if (!file) throw new Error('Installed files did not index the smoke file.');

    const manifest = runJson('files knowledge manifest', options.filesBin, ['knowledge', 'manifest', '--source', source.id, '--json'], { env: filesEnv });
    assertNoRaw(JSON.stringify(manifest), 'installed files manifest', sentinels);
    const manifestItem = manifest.items?.find((item) => item.file_id === file.id || item.source_ref === `open-files://file/${file.id}`);
    if (!manifestItem) throw new Error('Installed files manifest did not include the smoke source ref.');
    const sourceRef = manifestItem.source_ref;
    if (typeof sourceRef !== 'string' || !sourceRef.startsWith('open-files://file/')) {
      throw new Error(`Unexpected source_ref from installed files manifest: ${sourceRef}`);
    }
    if (!manifestItem.revision_id) throw new Error('Installed files manifest item is missing revision_id.');
    if (!manifestItem.open_files_root) throw new Error('Installed files manifest item is missing open_files_root.');

    const doctor = runJson('files knowledge doctor', options.filesBin, ['knowledge', 'doctor', sourceRef, '--json'], { env: filesEnv });
    const doctorCheck = doctor.checks?.find((check) => check.source_ref === sourceRef);
    if (!doctorCheck || doctorCheck.status !== 'ready') {
      throw new Error(`Installed files doctor did not report ready: ${JSON.stringify(doctor).slice(0, 1200)}`);
    }

    const resolved = runJson(
      'files knowledge resolve extracted_text',
      options.filesBin,
      ['knowledge', 'resolve', sourceRef, '--mode', 'extracted_text', '--json'],
      { env: filesEnv },
    );
    if (resolved.status !== 'ready') throw new Error(`Installed files resolver status is not ready: ${resolved.status}`);
    if (!JSON.stringify(resolved).includes(rawSentinel)) {
      throw new Error('Installed files resolver did not prove the raw sentinel exists at the source boundary.');
    }

    const extraction = runJson(
      'files extract-text redacted',
      options.filesBin,
      ['extract-text', file.id, '--json', '--redact', escapeRegExp(rawSentinel)],
      { env: filesEnv },
    );
    if (extraction.status !== 'ready') throw new Error(`Installed files redacted extraction is not ready: ${extraction.status}`);
    if (!extraction.redacted) throw new Error('Installed files extraction did not mark the result redacted.');
    const redactedText = extraction.segments?.map((segment) => segment.text).join('') ?? '';
    if (!redactedText.includes(allowedExtractedText)) throw new Error('Redacted extraction is missing the allowed extracted text.');
    assertNoRaw(redactedText, 'redacted extracted text', sentinels);

    const safeItem = {
      ...manifestItem,
      extracted_text_ref: resolved.content?.extracted_text_ref ?? `${sourceRef}/text`,
      extracted_text: redactedText,
      metadata: {
        ...(manifestItem.metadata && typeof manifestItem.metadata === 'object' ? manifestItem.metadata : {}),
        installed_open_files_boundary_smoke: true,
        extraction_redacted: true,
        resolver_status: resolved.status,
      },
    };
    assertNoRaw(JSON.stringify(safeItem), 'safe knowledge manifest item', sentinels);
    writeFileSync(manifestPath, `${JSON.stringify(safeItem)}\n`);

    runJson('knowledge db init source', options.knowledgeBin, ['db', 'init', '--scope', 'project', '--json'], { cwd: knowledgeSource, env: knowledgeEnv });
    runJson('knowledge db init peer', options.knowledgeBin, ['db', 'init', '--scope', 'project', '--json'], { cwd: knowledgePeer, env: knowledgeEnv });
    const ingest = runJson('knowledge ingest manifest', options.knowledgeBin, ['ingest', 'manifest', manifestPath, '--scope', 'project', '--json'], { cwd: knowledgeSource, env: knowledgeEnv });
    if (!ingest.ok || ingest.chunks_inserted < 1) throw new Error(`Knowledge manifest ingest did not insert chunks: ${JSON.stringify(ingest).slice(0, 1200)}`);
    const resolvedKnowledge = runJson('knowledge source resolve', options.knowledgeBin, ['source', 'resolve', sourceRef, '--scope', 'project', '--json'], { cwd: knowledgeSource, env: knowledgeEnv });
    if (!resolvedKnowledge.resolved || !resolvedKnowledge.content?.text_available) {
      throw new Error(`Knowledge did not resolve the installed open-files source ref: ${JSON.stringify(resolvedKnowledge).slice(0, 1200)}`);
    }
    const resolvedKnowledgeText = JSON.stringify(resolvedKnowledge);
    if (!resolvedKnowledgeText.includes(allowedExtractedText)) throw new Error('Knowledge resolver did not return the allowed extracted artifact.');
    assertNoRaw(resolvedKnowledgeText, 'knowledge source resolve result', sentinels);

    const doctorBefore = runJson('knowledge sync doctor', options.knowledgeBin, ['sync', 'doctor', '--peer-workspace', knowledgePeer, '--scope', 'project', '--json'], { cwd: knowledgeSource, env: knowledgeEnv });
    if (!doctorBefore.ok) throw new Error(`Knowledge sync doctor failed: ${JSON.stringify(doctorBefore).slice(0, 1200)}`);
    if (doctorBefore.open_files?.raw_payload_sentinel_hits !== 0) throw new Error('Knowledge sync doctor found raw open-files payload sentinels.');

    const initialDryRun = runJson('knowledge sync dry-run', options.knowledgeBin, ['sync', 'dry-run', '--peer-workspace', knowledgePeer, '--scope', 'project', '--json'], { cwd: knowledgeSource, env: knowledgeEnv });
    if (!initialDryRun.ok || (initialDryRun.push?.conflicts_created ?? tableConflicts(initialDryRun, 'push')) !== 0) {
      throw new Error(`Knowledge sync dry-run failed: ${JSON.stringify(initialDryRun).slice(0, 1200)}`);
    }
    const push = runJson('knowledge sync push', options.knowledgeBin, ['sync', 'push', '--peer-workspace', knowledgePeer, '--scope', 'project', '--json'], { cwd: knowledgeSource, env: knowledgeEnv });
    if (!push.ok || (push.push?.conflicts_created ?? tableConflicts(push, 'push')) !== 0) {
      throw new Error(`Knowledge sync push failed: ${JSON.stringify(push).slice(0, 1200)}`);
    }
    const afterPushDryRun = runJson('knowledge sync dry-run after push', options.knowledgeBin, ['sync', 'dry-run', '--peer-workspace', knowledgePeer, '--scope', 'project', '--json'], { cwd: knowledgeSource, env: knowledgeEnv });
    if (!afterPushDryRun.ok || tableInserted(afterPushDryRun, 'push') !== 0 || (afterPushDryRun.push?.conflicts_created ?? tableConflicts(afterPushDryRun, 'push')) !== 0) {
      throw new Error(`Knowledge sync did not converge after push: ${JSON.stringify(afterPushDryRun).slice(0, 1200)}`);
    }

    const sourceDbText = dumpSqliteText(knowledgeDbPath(knowledgeSource));
    const peerDbText = dumpSqliteText(knowledgeDbPath(knowledgePeer));
    const sourceArtifactText = readTextTree(artifactsPath(knowledgeSource));
    const peerArtifactText = readTextTree(artifactsPath(knowledgePeer));
    assertNoRaw(sourceDbText, 'source knowledge SQLite', sentinels);
    assertNoRaw(peerDbText, 'peer knowledge SQLite', sentinels);
    assertNoRaw(sourceArtifactText, 'source knowledge artifacts', sentinels);
    assertNoRaw(peerArtifactText, 'peer knowledge artifacts', sentinels);
    if (!peerDbText.includes(allowedExtractedText)) throw new Error('Peer knowledge store is missing the allowed extracted artifact.');

    const summary = {
      ok: true,
      generated_at: new Date().toISOString(),
      files_version: filesVersion,
      knowledge_version: knowledgeVersion,
      temp_dirs_kept: options.keepTemp,
      workspace_dirs: options.keepTemp ? { root, knowledge_source: knowledgeSource, knowledge_peer: knowledgePeer } : null,
      boundary: {
        source_refs: 1,
        source_ref: sourceRef,
        revision_id: manifestItem.revision_id,
        open_files_root: true,
        files_manifest_no_raw: true,
        files_doctor_ready: true,
        files_resolver_raw_source_seen: true,
        files_extract_text_redacted: true,
      },
      knowledge: {
        ingest_items_seen: ingest.items_seen,
        chunks_inserted: ingest.chunks_inserted,
        source_chunks: countRows(knowledgeDbPath(knowledgeSource), 'chunks'),
        source_revisions: countRows(knowledgeDbPath(knowledgeSource), 'source_revisions'),
      },
      peer: {
        source_chunks: countRows(knowledgeDbPath(knowledgePeer), 'chunks'),
        source_revisions: countRows(knowledgeDbPath(knowledgePeer), 'source_revisions'),
      },
      sync: {
        doctor_ok: doctorBefore.ok,
        open_files_raw_payload_sentinel_hits: doctorBefore.open_files?.raw_payload_sentinel_hits ?? 0,
        initial_dry_run_ok: initialDryRun.ok,
        initial_dry_run_inserted: tableInserted(initialDryRun, 'push'),
        push_ok: push.ok,
        push_inserted: tableInserted(push, 'push'),
        final_dry_run_ok: afterPushDryRun.ok,
      },
      raw_sentinel_absent_from_knowledge: true,
    };
    outputSummary(summary, options);
  } finally {
    if (!options.keepTemp) rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
