import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectKey, projectKnowledgeHome, resolveScopedWorkspace } from '../src/workspace';

let fakeHome: string;
let previousHome: string | undefined;
let previousUserProfile: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ok-knowledge-home-'));
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('canonical project-scoped knowledge home', () => {
  test('project scope resolves under ~/.hasna/knowledge/projects/<key> with a fake HOME', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'ok-project-'));
    try {
      const home = projectKnowledgeHome(projectDir);
      expect(home.startsWith(join(fakeHome, '.hasna', 'knowledge', 'projects'))).toBe(true);
      expect(home).toBe(join(fakeHome, '.hasna', 'knowledge', 'projects', projectKey(projectDir)));
      expect(resolveScopedWorkspace('project', projectDir).home).toBe(home);
      expect(resolveScopedWorkspace('local', projectDir).home).toBe(home);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test('global scope still resolves to ~/.hasna/knowledge', () => {
    expect(resolveScopedWorkspace('global').home).toBe(join(fakeHome, '.hasna', 'knowledge'));
  });

  test('two repos with the same basename get distinct project homes', () => {
    const base = mkdtempSync(join(tmpdir(), 'ok-parent-'));
    try {
      const first = join(base, 'app');
      const second = join(base, 'other', 'app');
      const homeFirst = projectKnowledgeHome(first);
      const homeSecond = projectKnowledgeHome(second);
      expect(homeFirst).not.toBe(homeSecond);
      expect(projectKey(first)).not.toBe(projectKey(second));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('the same checkout path resolves deterministically', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'ok-deterministic-'));
    try {
      expect(projectKnowledgeHome(projectDir)).toBe(projectKnowledgeHome(projectDir));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
