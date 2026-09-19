import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import recover_pre_mutation as recovery
from test_deploy import manifest


class Instrument(recovery.Recovery):
    def __init__(self, root):
        source, image, previous = 'a' * 40, 'sha256:' + 'b' * 64, 'sha256:' + 'c' * 64
        arn = 'arn:aws:ecs:us-east-1:123456789012:'
        plan = {'schema': 'knowledge.pre-mutation-recovery-plan.v1', 'account': '123456789012', 'region': 'us-east-1',
                'aws_profile': 'fixture', 'repository': 'hasna/apps', 'source': source, 'workflow_head': 'd' * 40,
                'run_id': 123, 'run_attempt': 1, 'image_digest': image, 'previous_image_digest': previous,
                'previous_desired_count': 1, 'previous_task_definition': arn + 'task-definition/knowledge-prod:35',
                'database_definition': arn + 'task-definition/knowledge-prod-migrate:37',
                'database_task': arn + 'task/oss-fleet-prod/' + 'e' * 32}
        prefix = f'deployment-backups/knowledge/123-1/{source}'
        phase = {'status': 'quiescence_requested', 'source_sha': source, 'image_digest': image,
                 'previous_image_digest': previous, 'previous_task_definition': plan['previous_task_definition'],
                 'previous_desired_count': 1, 'database_receipt_prefix': prefix}
        raw = json.dumps(phase).encode()
        path = root / 'phase.json'; path.write_bytes(raw)
        plan.update(phase_evidence_path=str(path), phase_evidence_sha256=recovery.digest(raw))
        super().__init__(plan)
        self.calls, self.updates, self.reads = [], 0, 0
        self.fail_fresh_service = False
        self.account = plan['account']
        self.manifest = manifest()
        self.head = SimpleNamespace(returncode=254, stdout=b'', stderr=b'An error occurred (404) when calling the HeadObject operation: Not Found\n')
        self.versions = {'Name': 'fixture-backups', 'Prefix': prefix + '/', 'IsTruncated': False}
        self.versioning = {'Status': 'Enabled'}
        self.task_list = {'taskArns': []}
        self.run = {'id': 123, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'failure',
                    'path': '.github/workflows/deploy-knowledge.yml', 'head_sha': plan['workflow_head']}
        self.active = {'total_count': 0, 'workflow_runs': []}
        self.service_value = {'status': 'ACTIVE', 'desiredCount': 0, 'runningCount': 0, 'pendingCount': 0,
                              'taskDefinition': plan['previous_task_definition'], 'deployments': [{'status': 'PRIMARY',
                              'rolloutState': 'COMPLETED', 'taskDefinition': plan['previous_task_definition'],
                              'desiredCount': 0, 'runningCount': 0, 'pendingCount': 0}]}
        ref = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:fixture'
        secret = [{'name': 'HASNA_KNOWLEDGE_DATABASE_URL', 'valueFrom': ref}]
        config = {'schema': 'knowledge.database-deploy.v1', 'source': source, 'image_digest': image, 'bucket': 'fixture-backups',
                  'prefix': prefix, 'legacy_owner_mode': 'disabled', 'migration_policy': 'no-pending-migrations'}
        self.migration = {'taskDefinitionArn': plan['database_definition'], 'containerDefinitions': [{'name': 'knowledge-migrate',
                          'image': self.manifest['ecr_repository_url'] + '@' + image, 'command': ['bun', 'deployment/database-phase.mjs'],
                          'environment': [{'name': 'KNOWLEDGE_DEPLOY_CONFIG', 'value': json.dumps(config)}], 'secrets': secret}]}
        self.old = {'taskDefinitionArn': plan['previous_task_definition'], 'containerDefinitions': [{'name': 'knowledge',
                    'image': self.manifest['ecr_repository_url'] + '@' + previous, 'secrets': secret}]}
        self.task = {'taskArn': plan['database_task'], 'taskDefinitionArn': plan['database_definition'], 'lastStatus': 'STOPPED',
                     'desiredStatus': 'STOPPED', 'stopCode': 'EssentialContainerExited', 'stoppedAt': '2026-01-01T00:00:00Z',
                     'containers': [{'name': 'knowledge-migrate', 'exitCode': 1, 'imageDigest': image}]}

    def command(self, args):
        self.calls.append(args)
        if args[0] == 'git':
            return SimpleNamespace(returncode=0, stdout=b'audited source')
        if args[0] == 'gh':
            value = self.active if 'status=' in args[-1] else self.run
            return SimpleNamespace(returncode=0, stdout=json.dumps(value).encode())
        raise AssertionError(args)

    def aws_command(self, args):
        self.calls.append(args)
        assert args[:2] == ['s3api', 'head-object']
        return self.head

    def aws(self, *args):
        self.calls.append(args)
        key = args[:2]
        if key == ('sts', 'get-caller-identity'): return {'Account': self.account}
        if key == ('ssm', 'get-parameter'): return {'Parameter': {'Value': json.dumps(self.manifest)}}
        if key == ('ecs', 'describe-task-definition'):
            return {'taskDefinition': copy.deepcopy(self.migration if args[-1] == self.plan['database_definition'] else self.old)}
        if key == ('ecs', 'describe-tasks'):
            if self.updates:
                return {'tasks': [{'taskArn': 'restored', 'taskDefinitionArn': self.plan['previous_task_definition'], 'lastStatus': 'RUNNING',
                                   'containers': [{'imageDigest': self.plan['previous_image_digest']}]}]}
            return {'tasks': [copy.deepcopy(self.task)]}
        if key == ('ecs', 'list-tasks'): return {'taskArns': ['restored']} if self.updates else copy.deepcopy(self.task_list)
        if key == ('s3api', 'get-bucket-versioning'): return copy.deepcopy(self.versioning)
        if key == ('s3api', 'list-object-versions'): return copy.deepcopy(self.versions)
        if key == ('ecs', 'describe-services'):
            self.reads += 1
            value = copy.deepcopy(self.service_value)
            if self.fail_fresh_service and self.reads > 1: value['desiredCount'] = 2
            if self.updates:
                value.update(desiredCount=1, runningCount=1)
                value['deployments'][0].update(desiredCount=1, runningCount=1)
            return {'services': [value]}
        if key == ('ecs', 'update-service'):
            self.updates += 1
            self.update_args = args
            return {}
        raise AssertionError(args)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.patch = patch.object(recovery, 'BARRIER_FILES', {'fixture': hashlib.sha256(b'audited source').hexdigest()})
        self.patch.start()
        self.source_patch = patch.object(recovery, 'AUDITED_SOURCE', 'a' * 40)
        self.source_patch.start()

    def tearDown(self):
        self.patch.stop()
        self.source_patch.stop()
        self.directory.cleanup()

    def test_readonly_proof_has_no_mutation_or_fabricated_migration_success(self):
        subject = Instrument(self.root)
        proof = subject.prove()
        self.assertEqual(proof['database_outcome'], 'stopped_before_verified_backup_barrier')
        self.assertNotIn('database_verified', proof)
        self.assertEqual(subject.updates, 0)
        self.assertFalse(any('get-secret-value' in c or 'run-task' in c or 'register-task-definition' in c for c in subject.calls))

    def test_negative_evidence_never_reaches_mutation(self):
        cases = [
            ('wrong account', lambda s: setattr(s, 'account', '999999999999')),
            ('active deployment', lambda s: setattr(s, 'active', {'total_count': 1, 'workflow_runs': [{}]})),
            ('wrong run source', lambda s: s.run.update(head_sha='f' * 40)),
            ('wrong run attempt', lambda s: s.run.update(run_attempt=2)),
            ('successful run', lambda s: s.run.update(conclusion='success')),
            ('task still running', lambda s: s.task.update(lastStatus='RUNNING')),
            ('task pending desired', lambda s: s.task.update(desiredStatus='RUNNING')),
            ('wrong stopped task', lambda s: s.task.update(taskArn='other')),
            ('wrong definition', lambda s: s.task.update(taskDefinitionArn='other')),
            ('task exit zero', lambda s: s.task['containers'][0].update(exitCode=0)),
            ('task different image', lambda s: s.task['containers'][0].update(imageDigest='other')),
            ('command override', lambda s: s.task.update(overrides={'containerOverrides': [{'name': 'knowledge-migrate', 'command': ['other']}]})),
            ('environment override', lambda s: s.task.update(overrides={'containerOverrides': [{'name': 'knowledge-migrate', 'environment': []}]})),
            ('extra container', lambda s: s.task['containers'].append({})),
            ('entrypoint changed', lambda s: s.migration['containerDefinitions'][0].update(entryPoint=['other'])),
            ('command changed', lambda s: s.migration['containerDefinitions'][0].update(command=['other'])),
            ('environment file', lambda s: s.migration['containerDefinitions'][0].update(environmentFiles=[{}])),
            ('wrong old image', lambda s: s.old['containerDefinitions'][0].update(image='other')),
            ('database mismatch', lambda s: s.old['containerDefinitions'][0].update(secrets=[])),
            ('live migration', lambda s: s.task_list.update(taskArns=['running'])),
            ('task pagination incomplete', lambda s: s.task_list.update(nextToken='more')),
            ('versioning suspended', lambda s: s.versioning.update(Status='Suspended')),
            ('backup exists', lambda s: s.versions.update(Versions=[{}])),
            ('backup deleted', lambda s: s.versions.update(DeleteMarkers=[{}])),
            ('versions truncated', lambda s: s.versions.update(IsTruncated=True)),
            ('truncation flag missing', lambda s: s.versions.pop('IsTruncated')),
            ('next version marker', lambda s: s.versions.update(NextVersionIdMarker='more')),
            ('wrong prefix', lambda s: s.versions.update(Prefix='other/')),
            ('head access denied', lambda s: setattr(s, 'head', SimpleNamespace(returncode=254, stderr=b'AccessDenied'))),
            ('head succeeded', lambda s: setattr(s, 'head', SimpleNamespace(returncode=0, stderr=b''))),
            ('service desired changed', lambda s: s.service_value.update(desiredCount=1)),
            ('service still running', lambda s: s.service_value.update(runningCount=1)),
            ('service still pending', lambda s: s.service_value.update(pendingCount=1)),
            ('service other definition', lambda s: s.service_value.update(taskDefinition='other')),
            ('two deployments', lambda s: s.service_value['deployments'].append({})),
        ]
        for label, change in cases:
            with self.subTest(label=label):
                subject = Instrument(self.root); change(subject)
                with self.assertRaises(ValueError): subject.restore(self.root / 'attempt.json', 'plan-hash')
                self.assertEqual(subject.updates, 0)
                self.assertFalse((self.root / 'attempt.json').exists())

    def test_one_exact_restore_after_immediate_service_comparison(self):
        subject = Instrument(self.root)
        receipt = subject.restore(self.root / 'attempt.json', 'plan-hash')
        self.assertEqual(subject.updates, 1)
        self.assertEqual(receipt['status'], 'old_image_restored_verified')
        position = next(i for i, c in enumerate(subject.calls) if tuple(c[:2]) == ('ecs', 'update-service'))
        self.assertEqual(tuple(subject.calls[position - 1][:2]), ('ecs', 'describe-services'))
        self.assertEqual(subject.update_args[-4:], ('--task-definition', subject.plan['previous_task_definition'], '--desired-count', '1'))
        self.assertEqual((self.root / 'attempt.json').stat().st_mode & 0o777, 0o600)

    def test_fresh_service_drift_refuses_and_retains_attempt_marker(self):
        subject = Instrument(self.root); subject.fail_fresh_service = True
        with self.assertRaisesRegex(ValueError, 'RECOVERY_SERVICE_NOT_QUIESCENT'):
            subject.restore(self.root / 'attempt.json', 'plan-hash')
        self.assertEqual(subject.updates, 0)
        self.assertTrue((self.root / 'attempt.json').exists())

    def test_existing_attempt_blocks_repeat_even_when_service_unchanged(self):
        attempt = self.root / 'attempt.json'; attempt.write_text('existing')
        subject = Instrument(self.root)
        with self.assertRaises(FileExistsError): subject.restore(attempt, 'plan-hash')
        self.assertEqual(subject.updates, 0)
        self.assertEqual(attempt.read_text(), 'existing')

    def test_changed_barrier_and_phase_refuse(self):
        subject = Instrument(self.root)
        with patch.object(recovery, 'BARRIER_FILES', {'fixture': '0' * 64}), self.assertRaisesRegex(ValueError, 'UNREVIEWED_DATABASE_BARRIER'):
            subject.prove()
        Path(subject.plan['phase_evidence_path']).write_text('{}')
        with self.assertRaisesRegex(ValueError, 'PHASE_EVIDENCE_DRIFT'): subject.prove()

    def test_source_requires_independent_barrier_review(self):
        with patch.object(recovery, 'AUDITED_SOURCE', 'f' * 40), self.assertRaisesRegex(ValueError, 'SOURCE_NOT_REVIEWED_FOR_RECOVERY'):
            Instrument(self.root)

    def test_head_cli_formats_keep_absence_separate_from_authorization_failure(self):
        subject = Instrument(self.root)
        subject.head.stderr = b'\naws: [ERROR]: An error occurred (404) when calling the HeadObject operation: Not Found\n'
        subject.prove()
        for code, body in [(254, b'An error occurred (403) when calling the HeadObject operation: Forbidden'),
                           (255, b'An error occurred (404) when calling the HeadObject operation: Not Found'),
                           (254, b'An error occurred (404) when calling the HeadObject operation: Not Found\nextra')]:
            subject.head.returncode, subject.head.stderr = code, body
            with self.assertRaisesRegex(ValueError, 'BACKUP_HEAD_NOT_PROVEN_ABSENT'): subject.prove()


if __name__ == '__main__':
    unittest.main()
