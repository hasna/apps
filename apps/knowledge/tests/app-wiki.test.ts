import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createAppWikiScope,
  openProjectWiki,
} from '../src/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

function runCli(args: string[], cwd: string, env: Record<string, string>) {
  return spawnSync('bun', [CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isolatedHomeEnv(home: string): Record<string, string> {
  return { HOME: home, USERPROFILE: home, HASNA_KNOWLEDGE_AUTH_DIR: join(home, 'auth') };
}

function jsonOut(result: ReturnType<typeof runCli>): any {
  expect(result.status ?? 0).toBe(0);
  return JSON.parse(result.stdout.toString('utf8'));
}

describe('app wiki standard', () => {
  test('sdk project wiki writes notes and source refs only under the scoped project store', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'ok-app-wiki-sdk-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-app-wiki-sdk-home-'));
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = home;
      process.env.USERPROFILE = home;

      const wiki = openProjectWiki({ cwd: projectDir });
      expect(wiki.paths().home).toBe(join(projectDir, '.hasna', 'knowledge'));
      expect(existsSync(join(projectDir, '.hasna', 'knowledge'))).toBe(false);

      const init = await wiki.init();
      expect(init.scope).toBe('project');
      expect(init.knowledge_db_path).toBe(join(projectDir, '.hasna', 'knowledge', 'knowledge.db'));

      const sourcePath = join(projectDir, 'source.md');
      writeFileSync(sourcePath, 'The scoped app wiki standard keeps project notes in the project catalog.');
      const sourceRef = pathToFileURL(sourcePath).href;
      const source = await wiki.sources.add({ sourceRef });
      expect(source.chunks_inserted).toBe(1);

      const note = await wiki.notes.add({
        title: 'Scoped App Wiki',
        content: 'Project apps write scoped app wiki notes through Knowledge SDK helpers.',
        tags: ['apps'],
        sourceRefs: [sourceRef],
      });
      expect(note.note.path).toBe('wiki/notes/scoped-app-wiki.md');
      expect(note.citations_written).toBe(1);
      expect(existsSync(join(projectDir, '.hasna', 'knowledge', 'artifacts', 'wiki', 'notes', 'scoped-app-wiki.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.hasna', 'knowledge', 'db.json'))).toBe(false);
      expect(existsSync(join(projectDir, '.husna'))).toBe(false);
      expect(existsSync(join(home, '.hasna', 'knowledge'))).toBe(false);

      const notes = wiki.notes.list();
      expect(notes).toHaveLength(1);
      expect(notes[0].source_refs).toEqual([sourceRef]);

      const found = await wiki.notes.get(note.note.id);
      expect(found?.content).toContain('Project apps write scoped app wiki notes');
      expect(found?.citations[0].source_uri).toBe(sourceRef);

      const search = await wiki.search({ query: 'Knowledge SDK helpers', limit: 5 });
      expect(search.results.some((entry) => entry.kind === 'wiki_chunk' && entry.artifact?.path === 'wiki/notes/scoped-app-wiki.md')).toBe(true);

      const query = await wiki.query({ query: 'scoped app wiki standard', limit: 5 });
      expect(query.excerpts.some((excerpt) => excerpt.text.includes('scoped app wiki standard'))).toBe(true);
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = oldUserProfile;
    }
  });

  test('sdk blocks global app wiki writes unless explicitly allowed', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'ok-app-wiki-global-block-'));
    const wiki = createAppWikiScope({ scope: 'global', cwd: projectDir });

    await expect(wiki.init()).rejects.toThrow('Global app-wiki writes require');
    await expect(wiki.notes.add({
      title: 'Blocked Global Wiki',
      content: 'This write must require explicit global permission.',
    })).rejects.toThrow('Global app-wiki writes require');
  });

  test('cli app-wiki workflow uses project scope and does not create ad hoc global markdown', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'ok-app-wiki-cli-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-app-wiki-cli-home-'));
    const env = isolatedHomeEnv(home);
    const sourcePath = join(projectDir, 'cli-source.md');
    writeFileSync(sourcePath, 'CLI app wiki source refs are ingested into the scoped project store.');
    const sourceRef = pathToFileURL(sourcePath).href;

    const source = jsonOut(runCli(['app-wiki', 'source', 'add', sourceRef, '--json'], projectDir, env));
    expect(source.chunks_inserted).toBe(1);

    const note = jsonOut(runCli([
      'app-wiki',
      'note',
      'add',
      '--title',
      'CLI App Wiki',
      '--content',
      'The CLI app-wiki command creates scoped notes through Knowledge, not loose Markdown.',
      '--source-ref',
      sourceRef,
      '--json',
    ], projectDir, env));
    expect(note.note.path).toBe('wiki/notes/cli-app-wiki.md');

    const search = jsonOut(runCli(['app-wiki', 'search', 'loose Markdown', '--json'], projectDir, env));
    expect(search.results.some((entry: any) => entry.artifact?.path === 'wiki/notes/cli-app-wiki.md')).toBe(true);

    const blocked = runCli([
      'app-wiki',
      'note',
      'add',
      '--scope',
      'global',
      '--title',
      'Blocked',
      '--content',
      'No global writes without the guard.',
      '--json',
    ], projectDir, env);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr.toString('utf8')).toContain('Global app-wiki writes require');

    expect(existsSync(join(projectDir, '.hasna', 'knowledge', 'artifacts', 'wiki', 'notes', 'cli-app-wiki.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.hasna', 'knowledge', 'db.json'))).toBe(false);
    expect(existsSync(join(projectDir, '.husna'))).toBe(false);
    expect(existsSync(join(home, '.hasna', 'knowledge'))).toBe(false);
    expect(readFileSync(join(projectDir, '.hasna', 'knowledge', 'artifacts', 'wiki', 'notes', 'cli-app-wiki.md'), 'utf8')).toContain('Source refs:');
  });
});
