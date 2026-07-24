import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');

function itemStore(): string {
  return `${JSON.stringify({
    items: [{
      id: 'k_stage_a_v5_context_pack',
      short_id: 'stage-a-v5-context-pack',
      title: 'Stage A V5 context pack',
      content: 'distinctive global evidence alpha beta gamma',
      url: null,
      tags: [],
      archived: false,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }],
  }, null, 2)}\n`;
}

describe('Stage A V5 correctness regressions', () => {
  test('contextPack enforces exact-own global authority across source, built, service, and SDK calls', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v5-context-pack-authority-'));
    const project = join(fixture, 'project');
    const storePath = join(fixture, 'db.json');
    mkdirSync(project, { mode: 0o700 });
    writeFileSync(storePath, itemStore(), { mode: 0o600 });
    try {
      for (const [index, moduleUrl] of [
        new URL('../src/index.ts', import.meta.url).href,
        new URL('../dist/index.js', import.meta.url).href,
      ].entries()) {
        const home = join(fixture, `home-${index}`);
        mkdirSync(home, { mode: 0o700 });
        const script = `
          const { KnowledgeService, createKnowledgeClient, createKnowledgeService } = await import(${JSON.stringify(moduleUrl)});
          const baseOptions = {
            query: 'distinctive global evidence',
            source: 'search',
            legacyStorePath: ${JSON.stringify(storePath)},
            maxItems: 1,
          };
          const assertEvidence = (pack, label) => {
            if (pack.evidence?.length !== 1) throw new Error(label + ' did not return the expected evidence');
          };
          const assertAuthorityRejected = async (invoke, label) => {
            let rejected = false;
            try { await invoke(); }
            catch (error) {
              rejected = /explicit own allowGlobal=true/i.test(String(error?.message ?? error));
            }
            if (!rejected) throw new Error(label + ' bypassed global context authority');
          };

          const service = createKnowledgeService({ scope: 'global', env: {} });
          const serviceInvocations = [
            ['normal', (options) => service.contextPack(options)],
            ['bound', service.contextPack.bind(service)],
            ['direct', (options) => Reflect.apply(service.contextPack, service, [options])],
            ['prototype', (options) => KnowledgeService.prototype.contextPack.call(service, options)],
          ];
          for (const [label, invoke] of serviceInvocations) {
            await assertAuthorityRejected(() => invoke({ ...baseOptions }), label + '/missing');
            await assertAuthorityRejected(
              () => invoke({ ...baseOptions, allowGlobal: false }),
              label + '/false',
            );
            assertEvidence(
              await invoke({ ...baseOptions, allowGlobal: true }),
              label + '/true',
            );
          }

          const client = createKnowledgeClient({ scope: 'global', allowGlobal: true, env: {} });
          for (const [label, invoke] of [
            ['contextPack', (options) => client.contextPack(options)],
            ['context.pack', (options) => client.context.pack(options)],
          ]) {
            assertEvidence(await invoke({ ...baseOptions }), label + '/constructor-authority');
            await assertAuthorityRejected(
              () => invoke({ ...baseOptions, allowGlobal: false }),
              label + '/false',
            );
            assertEvidence(await invoke({ ...baseOptions, allowGlobal: true }), label + '/true');
          }

          const projectService = createKnowledgeService({
            scope: 'project',
            cwd: ${JSON.stringify(project)},
            env: {},
          });
          assertEvidence(await projectService.contextPack(baseOptions), 'project service');
          const projectClient = createKnowledgeClient({
            scope: 'project',
            cwd: ${JSON.stringify(project)},
            env: {},
          });
          assertEvidence(await projectClient.contextPack(baseOptions), 'project SDK');
          assertEvidence(await projectClient.context.pack(baseOptions), 'project nested SDK');
        `;
        const result = Bun.spawnSync(['bun', '--eval', script], {
          cwd: project,
          env: sanitizedLocalTestEnv({
            HOME: home,
            USERPROFILE: home,
            BUN_CONFIG_INSTALL_AUTO: 'disable',
          }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
