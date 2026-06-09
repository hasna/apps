import { describe, expect, test } from 'bun:test';
import {
  KNOWLEDGE_MACHINES_ADAPTER_CONTRACT_VERSION,
  createKnowledgeMachinesAdapter,
  discoverKnowledgeMachineTopology,
  preflightKnowledgeMachine,
  resolveKnowledgeMachineRoute,
  resolveKnowledgeMachineWorkspace,
  type KnowledgeMachineCommandRunner,
  type KnowledgeMachinePreflightRunner,
} from '../src/machines';

function fakeCommandRunner(outputs: Record<string, string>): KnowledgeMachineCommandRunner {
  return (command) => {
    const key = Object.keys(outputs).find((entry) => command.includes(entry));
    return {
      stdout: key ? outputs[key] : '',
      stderr: key ? '' : `unexpected command: ${command}`,
      exitCode: key ? 0 : 1,
    };
  };
}

function fakePreflightRunner(outputs: Record<string, string>): KnowledgeMachinePreflightRunner {
  return (machineId, command) => {
    const key = Object.keys(outputs).find((entry) => command.includes(entry));
    return {
      stdout: key ? outputs[key] : '',
      stderr: key ? '' : `unexpected command: ${command}`,
      exitCode: key ? 0 : 1,
      source: machineId === 'local' ? 'local' : 'ssh',
    };
  };
}

describe('knowledge machine topology', () => {
  test('normalizes optional open-machines topology', async () => {
    const result = await discoverKnowledgeMachineTopology({
      includeTailscale: false,
      now: new Date('2026-06-09T00:00:00.000Z'),
      knowledge: {
        scope: 'project',
        workspace_home: '/repo/.hasna/apps/knowledge',
      },
      loadOpenMachines: async () => ({
        discoverMachineTopology: () => ({
          generated_at: '2026-06-09T00:00:00.000Z',
          local_machine_id: 'spark02',
          local_hostname: 'spark02',
          current_platform: 'linux',
          machines: [{
            machine_id: 'spark02',
            hostname: 'spark02',
            platform: 'linux',
            os: 'linux',
            user: 'hasna',
            workspace_path: '/repo',
            manifest_declared: true,
            heartbeat_status: 'online',
            last_heartbeat_at: '2026-06-09T00:00:00.000Z',
            tailscale: {
              dns_name: 'spark02.example.ts.net',
              ips: ['100.64.0.2'],
              online: true,
              active: true,
              last_seen: null,
            },
            ssh: {
              address: 'spark02',
              route: 'local',
              command_target: 'localhost',
            },
            route_hints: [{ kind: 'local', target: 'localhost', reachable: true }],
            tags: ['sync'],
            metadata: { role: 'workstation' },
          }],
          warnings: [],
        }),
      }),
    });

    expect(result.source).toBe('open-machines');
    expect(result.adapter.available).toBe(true);
    expect(result.adapter.implementation).toBe('sdk');
    expect(result.adapter.mode).toBe('auto');
    expect(result.knowledge.app_path).toBe('.hasna/apps/knowledge');
    expect(result.knowledge.workspace_home).toBe('/repo/.hasna/apps/knowledge');
    expect(result.machines).toHaveLength(1);
    expect(result.machines[0].local).toBe(true);
    expect(result.machines[0].tailscale.ips).toEqual(['100.64.0.2']);
  });

  test('falls back to local topology when open-machines is unavailable', async () => {
    const result = await discoverKnowledgeMachineTopology({
      includeTailscale: false,
      now: new Date('2026-06-09T00:00:00.000Z'),
      loadOpenMachines: async () => null,
      runner: fakeCommandRunner({}),
    });

    expect(result.source).toBe('local');
    expect(result.adapter.available).toBe(false);
    expect(result.adapter.implementation).toBe('disabled');
    expect(result.machines.length).toBeGreaterThanOrEqual(1);
    expect(result.machines.some((machine) => machine.local)).toBe(true);
    expect(result.warnings).toContain('open_machines_unavailable:missing_discoverMachineTopology');
  });

  test('uses machines CLI topology when SDK import is unavailable', async () => {
    const result = await discoverKnowledgeMachineTopology({
      includeTailscale: false,
      now: new Date('2026-06-09T00:00:00.000Z'),
      knowledge: {
        scope: 'project',
        workspace_home: '/repo/.hasna/apps/knowledge',
      },
      loadOpenMachines: async () => null,
      runner: fakeCommandRunner({
        'command -v machines': '/home/hasna/.bun/bin/machines\n',
        'topology': JSON.stringify({
          generated_at: '2026-06-09T00:00:00.000Z',
          local_machine_id: 'spark02',
          local_hostname: 'spark02',
          current_platform: 'linux',
          machines: [{
            machine_id: 'spark02',
            hostname: 'spark02',
            platform: 'linux',
            os: 'linux',
            workspace_path: '/repo',
            manifest_declared: false,
            heartbeat_status: 'unknown',
            tailscale: { dns_name: null, ips: [], online: null, active: null, last_seen: null },
            ssh: { address: null, route: 'local', command_target: 'localhost' },
            route_hints: [{ kind: 'local', target: 'localhost', reachable: true }],
            tags: [],
            metadata: {},
          }],
          warnings: [],
        }),
      }),
    });

    expect(result.source).toBe('open-machines');
    expect(result.adapter.available).toBe(true);
    expect(result.adapter.implementation).toBe('cli');
    expect(result.adapter.error).toBeNull();
    expect(result.machines[0].machine_id).toBe('spark02');
  });

  test('normalizes optional open-machines preflight report', async () => {
    const result = await preflightKnowledgeMachine({
      machineId: 'spark01',
      now: new Date('2026-06-09T00:00:00.000Z'),
      knowledge: {
        scope: 'project',
        workspace_home: '/repo/.hasna/apps/knowledge',
      },
      loadOpenMachines: async () => ({
        checkMachineCompatibility: () => ({
          ok: true,
          machine_id: 'spark01',
          generated_at: '2026-06-09T00:00:00.000Z',
          checks: [{
            id: 'package:@hasna/knowledge:version',
            kind: 'package',
            status: 'ok',
            target: '@hasna/knowledge',
            expected: '0.2.29',
            actual: '0.2.29',
            detail: 'version output: @hasna/knowledge 0.2.29',
            source: 'tailscale',
          }],
          summary: { ok: 1, warn: 0, fail: 0 },
        }),
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('open-machines');
    expect(result.adapter.available).toBe(true);
    expect(result.adapter.implementation).toBe('sdk');
    expect(result.machine_id).toBe('spark01');
    expect(result.checks[0].id).toBe('package:@hasna/knowledge:version');
  });

  test('falls back to local or ssh preflight when open-machines is unavailable', async () => {
    const result = await preflightKnowledgeMachine({
      machineId: 'spark01',
      now: new Date('2026-06-09T00:00:00.000Z'),
      loadOpenMachines: async () => null,
      runner: fakePreflightRunner({
        "cmd='bun'": 'path=/usr/bin/bun\nversion=1.3.13\n',
        "cmd='knowledge'": 'path=/home/hasna/.bun/bin/knowledge\nversion=@hasna/knowledge 0.2.29\n',
        "path='/repo/open-knowledge'": 'exists=yes\npackage_json=yes\npackage_name=@hasna/knowledge\nversion=0.2.29\n',
      }),
      commands: [{ command: 'bun', required: true }],
      packages: [{ name: '@hasna/knowledge', command: 'knowledge', expectedVersion: '0.2.29', required: true }],
      workspaces: [{
        label: 'open-knowledge',
        path: '/repo/open-knowledge',
        expectedPackageName: '@hasna/knowledge',
        expectedVersion: '0.2.29',
        required: true,
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('local');
    expect(result.adapter.implementation).toBe('disabled');
    expect(result.adapter.error).toBe('missing_checkMachineCompatibility');
    expect(result.summary.fail).toBe(0);
    expect(result.summary.warn).toBe(1);
    expect(result.checks.some((check) => check.id === 'adapter:@hasna/machines')).toBe(true);
  });

  test('uses machines CLI compatibility when SDK import is unavailable', async () => {
    const result = await preflightKnowledgeMachine({
      machineId: 'spark01',
      now: new Date('2026-06-09T00:00:00.000Z'),
      loadOpenMachines: async () => null,
      runner: fakePreflightRunner({
        'command -v machines': '/home/hasna/.bun/bin/machines\n',
        'compatibility': JSON.stringify({
          ok: true,
          machine_id: 'spark01',
          source: 'ssh',
          generated_at: '2026-06-09T00:00:00.000Z',
          checks: [{
            id: 'package:@hasna/knowledge:version',
            kind: 'package',
            status: 'ok',
            target: '@hasna/knowledge',
            expected: '0.2.32',
            actual: '0.2.32',
            detail: 'version output: @hasna/knowledge 0.2.32',
            source: 'ssh',
          }],
          summary: { ok: 1, warn: 0, fail: 0 },
        }),
      }),
      packages: [{ name: '@hasna/knowledge', command: 'knowledge', expectedVersion: '0.2.32', required: true }],
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('open-machines');
    expect(result.adapter.available).toBe(true);
    expect(result.adapter.implementation).toBe('cli');
    expect(result.adapter.error).toBeNull();
    expect(result.machine_id).toBe('spark01');
    expect(result.checks[0].source).toBe('ssh');
  });

  test('passes workspace package expectations through machines CLI compatibility', async () => {
    const commands: string[] = [];
    const result = await preflightKnowledgeMachine({
      machineId: 'spark01',
      now: new Date('2026-06-09T00:00:00.000Z'),
      loadOpenMachines: async () => null,
      runner: (machineId, command) => {
        commands.push(command);
        if (command.includes('command -v machines')) {
          return { stdout: '/home/hasna/.bun/bin/machines\n', stderr: '', exitCode: 0, source: machineId === 'local' ? 'local' : 'ssh' };
        }
        if (command.includes('compatibility')) {
          return {
            stdout: JSON.stringify({
              ok: true,
              machine_id: 'spark01',
              source: 'ssh',
              generated_at: '2026-06-09T00:00:00.000Z',
              checks: [{
                id: 'workspace:open-knowledge:package-name',
                kind: 'workspace',
                status: 'ok',
                target: 'open-knowledge',
                expected: '@hasna/knowledge',
                actual: '@hasna/knowledge',
                detail: 'package.json inspected',
                source: 'ssh',
              }],
              summary: { ok: 1, warn: 0, fail: 0 },
            }),
            stderr: '',
            exitCode: 0,
            source: 'ssh',
          };
        }
        return { stdout: '', stderr: `unexpected command: ${command}`, exitCode: 1, source: 'ssh' };
      },
      workspaces: [{
        label: 'open-knowledge',
        path: '/repo/open-knowledge',
        expectedPackageName: '@hasna/knowledge',
        expectedVersion: '0.2.34',
        required: true,
      }],
    });

    expect(result.ok).toBe(true);
    expect(commands.some((command) => command.includes('open-knowledge=/repo/open-knowledge:@hasna/knowledge:0.2.34'))).toBe(true);
    expect(result.checks[0].id).toBe('workspace:open-knowledge:package-name');
  });

  test('uses machines consumer SDK route resolver when available', async () => {
    const result = await resolveKnowledgeMachineRoute({
      machineId: 'spark01',
      now: new Date('2026-06-09T00:00:00.000Z'),
      loadOpenMachines: async () => ({
        resolveMachineRoute: () => ({
          ok: true,
          target: 'spark01.taild59be2.ts.net',
          route: 'tailscale',
          source: 'tailscale',
          confidence: 'high',
          evidence: {
            topology: true,
            matched_by: 'machine_id',
            selected_hint: {
              kind: 'tailscale',
              target: 'spark01.taild59be2.ts.net',
              reachable: true,
            },
          },
          warnings: [],
        }),
      }),
      runner: fakeCommandRunner({}),
    });

    expect(result).toMatchObject({
      source: 'open-machines',
      adapter: {
        implementation: 'sdk',
        mode: 'auto',
        available: true,
      },
      target: 'spark01.taild59be2.ts.net',
      route: 'tailscale',
      targetKind: 'tailscale',
      confidence: 'high',
      evidence: {
        topology: true,
        matched_by: 'machine_id',
        selected_hint: {
          kind: 'tailscale',
          target: 'spark01.taild59be2.ts.net',
          reachable: true,
        },
      },
      warnings: [],
    });
  });

  test('uses machines consumer SDK workspace resolver when available', async () => {
    const result = await resolveKnowledgeMachineWorkspace({
      machineId: 'spark01',
      now: new Date('2026-06-09T00:00:00.000Z'),
      loadOpenMachines: async () => ({
        resolveMachineWorkspace: () => ({
          ok: true,
          requested_machine_id: 'spark01',
          machine_id: 'spark01',
          project: {
            project_id: 'open-knowledge',
            repo_name: 'open-knowledge',
          },
          machine: {
            current: false,
            primary: true,
            trust_status: 'trusted',
            auth_status: 'authenticated',
          },
          paths: {
            workspace_root: { path: '/home/hasna/workspace', source: 'manifest' },
            project_root: { path: '/home/hasna/workspace/hasna/opensource/open-knowledge', source: 'inferred' },
            open_files_root: { path: '/home/hasna/workspace/hasna/opensource/open-files', source: 'inferred' },
          },
          diagnostics: [{
            id: 'project_root',
            status: 'inferred',
            severity: 'warn',
            message: 'project root inferred from workspace path',
            path: '/home/hasna/workspace/hasna/opensource/open-knowledge',
            source: 'inferred',
            path_exists: null,
          }],
          repair_hints: [{
            id: 'machines_workspace_repair',
            reason: 'Confirm workspace path mapping before sync.',
            command: ['machines', 'workspace', 'repair', '--machine', 'spark01', '--project', 'open-knowledge', '--repo', 'open-knowledge', '--open-files-repo', 'open-files', '--json'],
            shell_command: 'machines workspace repair --machine spark01 --project open-knowledge --repo open-knowledge --open-files-repo open-files --json',
            apply_command: ['machines', 'workspace', 'repair', '--machine', 'spark01', '--project', 'open-knowledge', '--repo', 'open-knowledge', '--open-files-repo', 'open-files', '--json', '--apply'],
            apply_shell_command: 'machines workspace repair --machine spark01 --project open-knowledge --repo open-knowledge --open-files-repo open-files --json --apply',
          }],
          evidence: {
            topology: true,
            matched_by: 'machine_id',
            metadata_keys: ['workspace_paths'],
          },
          warnings: ['project_root_inferred:open-knowledge'],
        }),
      }),
      runner: fakeCommandRunner({}),
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('open-machines');
    expect(result.adapter.implementation).toBe('sdk');
    expect(result.project_root).toBe('/home/hasna/workspace/hasna/opensource/open-knowledge');
    expect(result.open_files_root).toBe('/home/hasna/workspace/hasna/opensource/open-files');
    expect(result.trust_status).toBe('trusted');
    expect(result.primary).toBe(true);
    expect(result.diagnostics[0]).toMatchObject({
      id: 'project_root',
      status: 'inferred',
      severity: 'warn',
    });
    expect(result.repair_hints[0]?.shell_command).toContain('machines workspace repair');
  });

  test('uses machines CLI workspace resolver when SDK import is unavailable', async () => {
    const commands: string[] = [];
    const result = await resolveKnowledgeMachineWorkspace({
      machineId: 'spark01',
      includeTailscale: false,
      loadOpenMachines: async () => null,
      runner: (command) => {
        commands.push(command);
        if (command.includes('command -v machines')) {
          return { stdout: '/home/hasna/.bun/bin/machines\n', stderr: '', exitCode: 0 };
        }
        if (command.includes('workspace') && command.includes('resolve')) {
          return {
            stdout: JSON.stringify({
              ok: true,
              requested_machine_id: 'spark01',
              machine_id: 'spark01',
              project: { project_id: 'open-knowledge', repo_name: 'open-knowledge' },
              machine: { current: false, primary: false, trust_status: 'unknown', auth_status: 'unknown' },
              paths: {
                workspace_root: { path: '/workspace', source: 'manifest' },
                project_root: { path: '/workspace/open-knowledge', source: 'manifest_metadata' },
                open_files_root: { path: '/workspace/open-files', source: 'manifest_metadata' },
              },
              evidence: { topology: true, matched_by: 'machine_id', metadata_keys: [] },
              warnings: [],
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: `unexpected command: ${command}`, exitCode: 1 };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('open-machines');
    expect(result.adapter.implementation).toBe('cli');
    expect(result.project_root).toBe('/workspace/open-knowledge');
    expect(commands.some((command) => command.includes("'workspace'") && command.includes("'resolve'") && command.includes("'--no-tailscale'"))).toBe(true);
  });

  test('adds fallback workspace repair hints for older machines resolver warnings', async () => {
    const result = await resolveKnowledgeMachineWorkspace({
      machineId: 'spark01',
      loadOpenMachines: async () => ({
        resolveMachineWorkspace: () => ({
          ok: true,
          requested_machine_id: 'spark01',
          machine_id: 'spark01',
          project: { project_id: 'open-knowledge', repo_name: 'open-knowledge' },
          machine: { current: false, primary: false, trust_status: 'trusted', auth_status: 'authenticated' },
          paths: {
            workspace_root: { path: '/workspace', source: 'manifest' },
            project_root: { path: '/workspace/open-knowledge', source: 'inferred' },
            open_files_root: { path: '/workspace/open-files', source: 'inferred' },
          },
          evidence: { topology: true, matched_by: 'machine_id', metadata_keys: [] },
          warnings: ['project_root_inferred:open-knowledge'],
        }),
      }),
      runner: fakeCommandRunner({}),
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.repair_hints[0]).toMatchObject({
      id: 'machines_workspace_repair',
      reason: expect.stringContaining('Workspace paths'),
    });
    expect(result.repair_hints[0]?.command).toContain('--open-files-repo');
    expect(result.repair_hints[0]?.shell_command).toContain('machines');
  });

  test('uses explicit peer workspace as an override before machines lookup', async () => {
    const result = await resolveKnowledgeMachineWorkspace({
      machineId: 'spark01',
      peerWorkspace: '/manual/open-knowledge',
      loadOpenMachines: async () => {
        throw new Error('should not load machines');
      },
    });

    expect(result).toMatchObject({
      ok: true,
      source: 'argument',
      adapter: {
        implementation: 'disabled',
        error: 'argument_override',
      },
      project_root: '/manual/open-knowledge',
      project_root_source: 'argument',
    });
  });

  test('uses machines CLI route resolver when SDK import is unavailable', async () => {
    const commands: string[] = [];
    const result = await resolveKnowledgeMachineRoute({
      machineId: 'spark01',
      includeTailscale: false,
      now: new Date('2026-06-09T00:00:00.000Z'),
      loadOpenMachines: async () => null,
      runner: (command) => {
        commands.push(command);
        if (command.includes('command -v machines')) {
          return { stdout: '/home/hasna/.bun/bin/machines\n', stderr: '', exitCode: 0 };
        }
        if (command.includes('route')) {
          return {
            stdout: JSON.stringify({
              ok: true,
              target: 'cli-spark01.tailnet.test',
              route: 'tailscale',
              source: 'tailscale',
              confidence: 'high',
              evidence: {
                topology: true,
                matched_by: 'machine_id',
                selected_hint: {
                  kind: 'tailscale',
                  target: 'cli-spark01.tailnet.test',
                  reachable: true,
                },
              },
              warnings: [],
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: `unexpected command: ${command}`, exitCode: 1 };
      },
    });

    expect(result.source).toBe('open-machines');
    expect(result.adapter.implementation).toBe('cli');
    expect(result.target).toBe('cli-spark01.tailnet.test');
    expect(result.route).toBe('tailscale');
    expect(result.targetKind).toBe('tailscale');
    expect(commands.some((command) => command.includes("'route'") && command.includes("'--no-tailscale'"))).toBe(true);
  });

  test('falls back to raw machine target when SDK and CLI route resolver are unavailable', async () => {
    const result = await resolveKnowledgeMachineRoute({
      machineId: 'spark01',
      loadOpenMachines: async () => null,
      runner: fakeCommandRunner({}),
    });

    expect(result).toMatchObject({
      source: 'raw',
      adapter: {
        implementation: 'disabled',
        error: 'missing_resolveMachineRoute',
      },
      target: 'spark01',
      route: null,
      targetKind: null,
      confidence: null,
      evidence: null,
      warnings: [],
    });
  });

  test('creates an explicit disabled machines adapter', async () => {
    const adapter = createKnowledgeMachinesAdapter({
      mode: 'disabled',
      now: new Date('2026-06-09T00:00:00.000Z'),
      runner: fakeCommandRunner({}),
      preflightRunner: fakePreflightRunner({
        "cmd='knowledge'": 'path=/home/hasna/.bun/bin/knowledge\nversion=@hasna/knowledge 0.2.40\n',
      }),
    });

    expect(adapter.mode).toBe('disabled');
    expect(await adapter.status()).toMatchObject({
      contract_version: null,
      implementation: 'disabled',
      available: false,
    });
    const route = await adapter.route({ machineId: 'spark01' });
    expect(route.source).toBe('raw');
    expect(route.adapter.error).toBe('adapter_disabled');
    const topology = await adapter.topology({ includeTailscale: false });
    expect(topology.source).toBe('local');
    expect(topology.adapter.implementation).toBe('disabled');
  });

  test('creates an explicit CLI-only machines adapter', async () => {
    const adapter = createKnowledgeMachinesAdapter({
      mode: 'cli',
      runner: fakeCommandRunner({
        'command -v machines': '/home/hasna/.bun/bin/machines\n',
        'route': JSON.stringify({
          ok: true,
          target: 'spark01.taild59be2.ts.net',
          route: 'tailscale',
          source: 'tailscale',
          confidence: 'high',
          evidence: { selected_hint: { kind: 'tailscale' } },
          warnings: [],
        }),
      }),
    });

    expect(await adapter.status()).toMatchObject({
      implementation: 'cli',
      available: true,
      contract_version: null,
    });
    const route = await adapter.route({ machineId: 'spark01', includeTailscale: false });
    expect(route.source).toBe('open-machines');
    expect(route.adapter.mode).toBe('cli');
    expect(route.adapter.implementation).toBe('cli');
  });

  test('reports SDK adapter contract version when available', async () => {
    const adapter = createKnowledgeMachinesAdapter({
      mode: 'sdk',
      loadOpenMachines: async () => ({
        MACHINES_CONSUMER_CONTRACT_VERSION: KNOWLEDGE_MACHINES_ADAPTER_CONTRACT_VERSION,
      }),
    });

    expect(await adapter.status()).toMatchObject({
      mode: 'sdk',
      implementation: 'sdk',
      available: true,
      contract_version: 1,
    });
  });
});
