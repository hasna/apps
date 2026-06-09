import { describe, expect, test } from 'bun:test';
import { discoverKnowledgeMachineTopology, preflightKnowledgeMachine, type KnowledgeMachinePreflightRunner } from '../src/machines';

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
    });

    expect(result.source).toBe('local');
    expect(result.adapter.available).toBe(false);
    expect(result.machines.length).toBeGreaterThanOrEqual(1);
    expect(result.machines.some((machine) => machine.local)).toBe(true);
    expect(result.warnings).toContain('open_machines_unavailable:missing_discoverMachineTopology');
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
    expect(result.adapter.error).toBe('missing_checkMachineCompatibility');
    expect(result.summary.fail).toBe(0);
    expect(result.summary.warn).toBe(1);
    expect(result.checks.some((check) => check.id === 'adapter:@hasna/machines')).toBe(true);
  });
});
