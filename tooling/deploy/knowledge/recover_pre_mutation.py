#!/usr/bin/env python3
"""Explicit, reviewed recovery for a stopped task before the backup barrier.

No database restore, task registration, secret read, or deployment retry. ECS has
no atomic UpdateService CAS: the complete proof is refreshed, then the service
is compared immediately before the one permitted update. A durable attempt file
prevents an ambiguous update from being retried automatically.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from deploy import container, require, stable_service, validate_manifest, verify_database_secret_bindings


# Audited source: read-only transaction/pg_dump precede versioned PutObject and
# exact-version readback. Every ledger/DDL write follows that durable barrier.
# A changed implementation requires a new review, never a caller-supplied hash.
AUDITED_SOURCE = 'e7642aecc5a677c46faaf1cc7a8ebb04e81dbec2'
BARRIER_FILES = {
    'tooling/deploy/knowledge/database-phase.mjs': 'a3f8345d109acc68f7930aade7c55111868ff22899be122d9cc8ec2d3a92c7b9',
    'apps/knowledge/src/db/remote-storage.ts': 'fb0de3d1c164c2602b00962dfc5995fc80daf394ace803d7928b3322247c0179',
    'apps/knowledge/src/generated/storage-kit/pool.ts': 'afc29e41e4fd17bd29571453385823bdad90ae6fcd0f0787f7f40eaf49933cd4',
    'apps/knowledge/Dockerfile': '6cf31838cfced53bdce0d30ed9283e72bc1d87cf268bbb549b9bed65b0316a73',
    'tooling/deploy/knowledge/Dockerfile': '760b5a628a23d9aa1697c836a239c27fe8d54fae99c7b78be6f48c3ce4018418',
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def exclusive_json(path, value):
    with open(path, 'x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())


class Recovery:
    def __init__(self, plan):
        self.plan = plan
        require(plan.get('schema') == 'knowledge.pre-mutation-recovery-plan.v1', 'PLAN_SCHEMA')
        require(re.fullmatch(r'[0-9]{12}', plan.get('account', '')), 'PLAN_ACCOUNT')
        require(re.fullmatch(r'[a-z]{2}-[a-z]+-[0-9]', plan.get('region', '')), 'PLAN_REGION')
        require(re.fullmatch(r'[0-9a-f]{40}', plan.get('source', '')), 'PLAN_SOURCE')
        require(plan['source'] == AUDITED_SOURCE, 'SOURCE_NOT_REVIEWED_FOR_RECOVERY')
        require(plan.get('previous_desired_count') == 1, 'PLAN_PREVIOUS_COUNT')
        require(plan.get('repository') == 'hasna/apps', 'PLAN_REPOSITORY')
        for field in ('image_digest', 'previous_image_digest'):
            require(re.fullmatch(r'sha256:[0-9a-f]{64}', plan.get(field, '')), 'PLAN_DIGEST')
        prefix = f"arn:aws:ecs:{plan['region']}:{plan['account']}:"
        require(re.fullmatch(re.escape(prefix + 'task/oss-fleet-prod/') + r'[0-9a-f]{32}', plan.get('database_task', '')), 'PLAN_TASK')
        for field, family in [('database_definition', 'knowledge-prod-migrate'), ('previous_task_definition', 'knowledge-prod')]:
            require(re.fullmatch(re.escape(prefix + 'task-definition/' + family + ':') + r'[1-9][0-9]*', plan.get(field, '')), 'PLAN_DEFINITION')
        self.repository = Path(__file__).resolve().parents[3]

    def command(self, args):
        return subprocess.run(args, capture_output=True, timeout=90)

    def aws_command(self, args):
        return self.command(['aws', '--profile', self.plan['aws_profile'], '--region', self.plan['region'], *args, '--output', 'json'])

    def aws(self, *args):
        result = self.aws_command(args)
        require(result.returncode == 0, 'AWS_' + args[0].upper() + '_REFUSED')
        return json.loads(result.stdout or b'{}')

    def absent_head(self, key):
        result = self.aws_command(['s3api', 'head-object', '--bucket', self.contract['backup_bucket'], '--key', key])
        # An access denial, timeout, missing credentials or unparseable error is
        # not absence. Do not emit AWS error payloads or their possible values.
        require(result.returncode == 254 and re.fullmatch(
            rb'\s*(?:aws: \[ERROR\]: )?An error occurred \(404\) when calling the HeadObject operation: Not Found\s*', result.stderr), 'BACKUP_HEAD_NOT_PROVEN_ABSENT')

    def no_tasks(self, **selector):
        for desired in ('RUNNING', 'PENDING'):
            args = ['ecs', 'list-tasks', '--cluster', 'oss-fleet-prod', '--desired-status', desired, '--no-paginate']
            for key, value in selector.items():
                args.extend(['--' + key.replace('_', '-'), value])
            value = self.aws(*args)
            require(value.get('taskArns') == [] and not value.get('nextToken'), 'CONCURRENT_TASK_OR_INCOMPLETE_INVENTORY')

    def service(self):
        value = self.aws('ecs', 'describe-services', '--cluster', 'oss-fleet-prod', '--services', 'knowledge-prod')
        require(not value.get('failures') and len(value.get('services', [])) == 1, 'SERVICE_READ')
        return value['services'][0]

    def quiescent(self):
        value = self.service()
        require(value.get('status') == 'ACTIVE' and value.get('taskDefinition') == self.plan['previous_task_definition'], 'RECOVERY_TASK_DRIFT')
        require(all(value.get(k) == 0 for k in ('desiredCount', 'runningCount', 'pendingCount')), 'RECOVERY_SERVICE_NOT_QUIESCENT')
        rows = value.get('deployments', [])
        require(len(rows) == 1 and rows[0].get('status') == 'PRIMARY' and rows[0].get('rolloutState') == 'COMPLETED'
                and rows[0].get('taskDefinition') == self.plan['previous_task_definition']
                and all(rows[0].get(k) == 0 for k in ('desiredCount', 'runningCount', 'pendingCount')), 'RECOVERY_DEPLOYMENT_DRIFT')
        return value

    def workflow_idle(self):
        # Explicitly end pagination for every active Actions state. Do not print
        # free text, links or check details returned by GitHub.
        for state in ('queued', 'in_progress', 'waiting', 'requested', 'pending'):
            route = f"repos/{self.plan['repository']}/actions/workflows/deploy-knowledge.yml/runs?status={state}&per_page=100&page=1"
            result = self.command(['gh', 'api', route])
            require(result.returncode == 0, 'DEPLOYMENT_INVENTORY_REFUSED')
            value = json.loads(result.stdout)
            require(value.get('total_count') == 0 and value.get('workflow_runs') == [], 'CONCURRENT_DEPLOYMENT')
        result = self.command(['gh', 'api', f"repos/{self.plan['repository']}/actions/runs/{self.plan['run_id']}/attempts/{self.plan['run_attempt']}"])
        require(result.returncode == 0, 'FAILED_RUN_READ')
        value = json.loads(result.stdout)
        require(value.get('id') == self.plan['run_id'] and value.get('run_attempt') == self.plan['run_attempt']
                and value.get('status') == 'completed' and value.get('conclusion') == 'failure'
                and value.get('path') == '.github/workflows/deploy-knowledge.yml'
                and value.get('head_sha') == self.plan['workflow_head'], 'FAILED_RUN_IDENTITY')

    def prove(self):
        p = self.plan
        require(self.aws('sts', 'get-caller-identity').get('Account') == p['account'], 'AWS_ACCOUNT_IDENTITY')
        manifest = json.loads(self.aws('ssm', 'get-parameter', '--name', '/hasna/deploy/knowledge')['Parameter']['Value'])
        self.contract = validate_manifest(manifest, p['account'], p['region'])['knowledge_deploy']
        self.image = manifest['ecr_repository_url']
        phase_raw = Path(p['phase_evidence_path']).read_bytes()
        require(digest(phase_raw) == p['phase_evidence_sha256'], 'PHASE_EVIDENCE_DRIFT')
        expected_prefix = f"{self.contract['backup_prefix']}/{p['run_id']}-{p['run_attempt']}/{p['source']}"
        phase = json.loads(phase_raw)
        require(phase == {'status': 'quiescence_requested', 'source_sha': p['source'], 'image_digest': p['image_digest'],
                         'previous_task_definition': p['previous_task_definition'], 'previous_image_digest': p['previous_image_digest'],
                         'previous_desired_count': p['previous_desired_count'], 'database_receipt_prefix': expected_prefix}, 'PHASE_EVIDENCE_IDENTITY')
        for file, expected in BARRIER_FILES.items():
            result = self.command(['git', '-C', str(self.repository), 'show', p['source'] + ':' + file])
            require(result.returncode == 0 and digest(result.stdout) == expected, 'UNREVIEWED_DATABASE_BARRIER')
        self.workflow_idle()
        value = self.aws('ecs', 'describe-tasks', '--cluster', 'oss-fleet-prod', '--tasks', p['database_task'])
        require(not value.get('failures') and len(value.get('tasks', [])) == 1, 'DATABASE_TASK_READ')
        task = value['tasks'][0]
        require(task.get('taskArn') == p['database_task'] and task.get('taskDefinitionArn') == p['database_definition']
                and task.get('lastStatus') == 'STOPPED' and task.get('desiredStatus') == 'STOPPED'
                and task.get('stopCode') == 'EssentialContainerExited' and task.get('stoppedAt'), 'DATABASE_TASK_NOT_STOPPED')
        rows = task.get('containers', [])
        require(len(rows) == 1 and rows[0].get('name') == 'knowledge-migrate' and rows[0].get('exitCode') == 1
                and rows[0].get('imageDigest') == p['image_digest'], 'DATABASE_TASK_IMAGE_OR_EXIT')
        overrides = task.get('overrides', {}).get('containerOverrides', [])
        require(overrides in ([], [{'name': 'knowledge-migrate'}]), 'DATABASE_EXECUTION_OVERRIDE')
        migration = self.aws('ecs', 'describe-task-definition', '--task-definition', p['database_definition'])['taskDefinition']
        require(migration.get('taskDefinitionArn') == p['database_definition'], 'DATABASE_DEFINITION_DRIFT')
        row = container(migration, 'knowledge-migrate')
        require(row.get('image') == self.image + '@' + p['image_digest'] and not row.get('entryPoint')
                and row.get('command') == ['bun', 'deployment/database-phase.mjs'] and not row.get('environmentFiles'), 'DATABASE_EXECUTION_IDENTITY')
        config_rows = [e['value'] for e in row.get('environment', []) if e['name'] == 'KNOWLEDGE_DEPLOY_CONFIG']
        require(len(config_rows) == 1 and not any(e['name'] == 'KNOWLEDGE_DEPLOY_CONFIG' for e in row.get('secrets', [])), 'DATABASE_CONFIG_OVERRIDE')
        config = {'schema': 'knowledge.database-deploy.v1', 'source': p['source'], 'image_digest': p['image_digest'],
                  'bucket': self.contract['backup_bucket'], 'prefix': expected_prefix, 'legacy_owner_mode': 'disabled',
                  'migration_policy': self.contract['migration_policy']}
        if self.contract.get('reviewed_migrations_sha256'):
            config['reviewed_migrations_sha256'] = self.contract['reviewed_migrations_sha256']
        require(json.loads(config_rows[0]) == config, 'DATABASE_CONFIG_DRIFT')
        old = self.aws('ecs', 'describe-task-definition', '--task-definition', p['previous_task_definition'])['taskDefinition']
        require(old.get('taskDefinitionArn') == p['previous_task_definition'] and container(old, 'knowledge').get('image')
                == self.image + '@' + p['previous_image_digest'], 'PREVIOUS_IMAGE_DRIFT')
        verify_database_secret_bindings(old, migration)
        self.no_tasks(family='knowledge-prod-migrate')
        self.no_tasks(service_name='knowledge-prod')
        require(self.aws('s3api', 'get-bucket-versioning', '--bucket', self.contract['backup_bucket']).get('Status') == 'Enabled', 'BACKUP_VERSIONING')
        versions = self.aws('s3api', 'list-object-versions', '--bucket', self.contract['backup_bucket'],
                            '--prefix', expected_prefix + '/', '--max-keys', '1000', '--no-paginate')
        require(versions.get('Name') == self.contract['backup_bucket'] and versions.get('Prefix') == expected_prefix + '/'
                and versions.get('IsTruncated') is False and not versions.get('Versions') and not versions.get('DeleteMarkers')
                and not versions.get('NextKeyMarker') and not versions.get('NextVersionIdMarker'), 'BACKUP_HISTORY_NOT_EMPTY_OR_INCOMPLETE')
        for name in ('database.dump', 'receipt.json'):
            self.absent_head(expected_prefix + '/' + name)
        self.quiescent()
        return {'schema': 'knowledge.pre-mutation-proof.v1', 'database_task': p['database_task'], 'source': p['source'],
                'image_digest': p['image_digest'], 'database_outcome': 'stopped_before_verified_backup_barrier',
                'backup_prefix': expected_prefix, 'version_history_complete': True, 'versions': 0, 'delete_markers': 0,
                'backup_head_status': 404, 'receipt_head_status': 404, 'previous_task_definition': p['previous_task_definition'],
                'previous_image_digest': p['previous_image_digest'], 'previous_desired_count': 1, 'barrier_files': BARRIER_FILES}

    def restore(self, attempt_path, plan_sha):
        proof = self.prove()
        exclusive_json(attempt_path, {'plan_sha256': plan_sha, 'proof': proof, 'status': 'restore_attempt_reserved'})
        # Last operations before mutation recheck competitors and exact service.
        self.workflow_idle()
        self.no_tasks(family='knowledge-prod-migrate')
        self.no_tasks(service_name='knowledge-prod')
        self.quiescent()
        p = self.plan
        self.aws('ecs', 'update-service', '--cluster', 'oss-fleet-prod', '--service', 'knowledge-prod',
                 '--task-definition', p['previous_task_definition'], '--desired-count', '1')
        for _ in range(120):
            value = self.service()
            require(value.get('taskDefinition') == p['previous_task_definition'] and value.get('desiredCount') == 1, 'RECOVERY_ROLLOUT_DRIFT')
            try:
                stable_service(value, p['previous_task_definition'], 1)
                tasks = self.aws('ecs', 'list-tasks', '--cluster', 'oss-fleet-prod', '--service-name', 'knowledge-prod', '--no-paginate')
                require(len(tasks.get('taskArns', [])) == 1 and not tasks.get('nextToken'), 'RECOVERY_RUNNING_COUNT')
                actual = self.aws('ecs', 'describe-tasks', '--cluster', 'oss-fleet-prod', '--tasks', *tasks['taskArns'])
                require(not actual.get('failures') and len(actual.get('tasks', [])) == 1, 'RECOVERY_RUNNING_READ')
                row = actual['tasks'][0]
                require(row.get('taskDefinitionArn') == p['previous_task_definition'] and row.get('lastStatus') == 'RUNNING'
                        and len(row.get('containers', [])) == 1 and row['containers'][0].get('imageDigest') == p['previous_image_digest'], 'RECOVERY_RUNNING_DIGEST')
                return {**proof, 'status': 'old_image_restored_verified', 'running_task': row['taskArn']}
            except ValueError:
                time.sleep(5)
        raise ValueError('RECOVERY_ROLLOUT_TIMEOUT')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--expected-plan-sha256', required=True)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--restore', action='store_true')
    args = parser.parse_args()
    raw = Path(args.plan).read_bytes()
    require(digest(raw) == args.expected_plan_sha256, 'PLAN_DIGEST_DRIFT')
    require(not Path(args.receipt).exists(), 'RECEIPT_EXISTS')
    recovery = Recovery(json.loads(raw))
    value = (recovery.restore(args.receipt + '.attempt.json', digest(raw)) if args.restore else recovery.prove())
    exclusive_json(args.receipt, {**value, 'plan_sha256': digest(raw), 'operator_sha256': digest(Path(__file__).read_bytes()),
                                 'checked_at_unix': int(time.time()), 'restoration_requested': args.restore})
    print('KNOWLEDGE_PRE_MUTATION_' + ('RESTORED' if args.restore else 'PROVEN'))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[A-Z_]+', str(error)) else type(error).__name__
        print('KNOWLEDGE_PRE_MUTATION_REFUSED:' + code)
        raise SystemExit(1)
