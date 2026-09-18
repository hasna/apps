import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from deploy import (validate_manifest, registration, stable_service, validate_receipt,
                    reviewed_migrations, verify_database_secret_bindings, Deployment)

ACCOUNT = '123456789012'
DIGEST = 'sha256:' + 'a' * 64


def manifest():
    return {'app': 'knowledge', 'account_id': ACCOUNT, 'region': 'us-east-1',
            'cluster': 'oss-fleet-prod', 'service': 'knowledge-prod', 'web_task_family': 'knowledge-prod',
            'web_container': 'knowledge', 'migration_task_family': 'knowledge-prod-migrate',
            'migration_container': 'knowledge-migrate', 'ecr_repository_url': f'{ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/knowledge',
            'assign_public_ip': 'ENABLED', 'subnets': ['subnet-123'], 'security_groups': ['sg-123'],
            'knowledge_deploy': {'schema': 'knowledge.production-deploy.v1', 'migration_policy': 'no-pending-migrations',
              'legacy_owner_mode': 'disabled', 'allow_service_quiescence': True, 'authority_classification': 'hasna_saas',
              'authority_id': 'fixture-authority', 'backup_bucket': 'fixture-backups', 'backup_prefix': 'deployment-backups/knowledge',
              'client_key_secret_id': 'hasna/oss/knowledge/api-key'}}


class Guards(unittest.TestCase):
    def test_additive_policy_requires_exact_reviewed_contract(self):
        _, checksum = reviewed_migrations()
        candidate = manifest()
        contract = candidate['knowledge_deploy']
        contract.update(migration_policy='reviewed-additive-nonce-v1', reviewed_migrations_sha256=checksum)
        validate_manifest(candidate, ACCOUNT, 'us-east-1')
        for changed in [None, '0' * 64, checksum.upper()]:
            contract['reviewed_migrations_sha256'] = changed
            with self.subTest(checksum=changed), self.assertRaisesRegex(ValueError, 'REVIEWED_MIGRATION_CONTRACT'):
                validate_manifest(candidate, ACCOUNT, 'us-east-1')
        contract.update(migration_policy='no-pending-migrations', reviewed_migrations_sha256=checksum)
        with self.assertRaisesRegex(ValueError, 'UNEXPECTED_MIGRATION_CONTRACT'):
            validate_manifest(candidate, ACCOUNT, 'us-east-1')

    def test_runtime_privilege_proof_uses_the_actual_web_database_secret(self):
        key = 'HASNA_KNOWLEDGE_DATABASE_URL'
        ref = f'arn:aws:secretsmanager:us-east-1:{ACCOUNT}:secret:fixture-runtime'
        web = {'containerDefinitions': [{'name': 'knowledge', 'secrets': [{'name': key, 'valueFrom': ref}]}]}
        migration = {'containerDefinitions': [{'name': 'knowledge-migrate', 'secrets': [{'name': key, 'valueFrom': ref}]}]}
        verify_database_secret_bindings(web, migration)
        for secrets, environment in [
            ([], []),
            ([{'name': key, 'valueFrom': ref + '-other'}], []),
            ([{'name': key, 'valueFrom': ref}] * 2, []),
            ([{'name': key, 'valueFrom': ref}], [{'name': key, 'value': 'synthetic-override'}]),
        ]:
            changed = copy.deepcopy(migration)
            changed['containerDefinitions'][0].update(secrets=secrets, environment=environment)
            with self.subTest(secrets=len(secrets), environment=bool(environment)), self.assertRaises(ValueError):
                verify_database_secret_bindings(web, changed)

    def test_manifest_requires_reviewed_backup_and_owner_contract(self):
        validate_manifest(manifest(), ACCOUNT, 'us-east-1')
        for field, value in [('legacy_owner_mode', 'infer'), ('legacy_owner_tenant_id', 'guessed'),
                             ('migration_policy', 'allow'), ('allow_service_quiescence', False),
                             ('client_key_secret_id', 'other-key')]:
            candidate = manifest()
            candidate['knowledge_deploy'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_manifest(candidate, ACCOUNT, 'us-east-1')

    def test_service_drift_and_partial_rollout_refused(self):
        service = {'status': 'ACTIVE', 'desiredCount': 1, 'runningCount': 1, 'pendingCount': 0,
                   'taskDefinition': 'expected', 'deployments': [{'status': 'PRIMARY', 'rolloutState': 'COMPLETED', 'taskDefinition': 'expected'}]}
        stable_service(service, 'expected', 1)
        for field, value in [('runningCount', 0), ('pendingCount', 1), ('taskDefinition', 'foreign'), ('deployments', [])]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                stable_service({**service, field: value}, 'expected', 1)

    def test_registration_preserves_unrelated_properties_and_secrets(self):
        original = {'family': 'knowledge-prod', 'revision': 10, 'containerDefinitions': [{'name': 'knowledge',
            'image': 'old', 'environment': [{'name': 'KEEP', 'value': 'kept'}, {'name': 'HASNA_KNOWLEDGE_STORAGE_MODE', 'value': 'cloud'}],
            'secrets': [{'name': 'DATABASE', 'valueFrom': 'secret-reference'}], 'portMappings': [{'containerPort': 8080}]}]}
        before = copy.deepcopy(original)
        revised = registration(original, 'knowledge', 'new')
        self.assertEqual(original, before)
        self.assertNotIn('revision', revised)
        self.assertEqual(revised['containerDefinitions'][0]['secrets'], original['containerDefinitions'][0]['secrets'])
        self.assertEqual(revised['containerDefinitions'][0]['environment'], [{'name': 'KEEP', 'value': 'kept'}])

    def test_cli_probe_matches_credential_owner_and_removes_the_file(self):
        deployment = object.__new__(Deployment)
        deployment.contract = {'client_key_secret_id': 'hasna/oss/knowledge/api-key'}
        with tempfile.TemporaryDirectory() as directory:
            deployment.root = Path(directory)
            def cli(args, **kwargs):
                credential = deployment.root / 'credentials'
                self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
                self.assertEqual(args[args.index('--user') + 1], f'{credential.stat().st_uid}:{os.getgid()}')
                self.assertIn('HOME=/tmp/knowledge-cli', args)
                self.assertTrue(kwargs['capture_output'])
                return SimpleNamespace(returncode=0, stdout=json.dumps({'ok': True, 'verified': True, 'probe': 'live',
                    'status': 200, 'principal': {'app': 'knowledge', 'kid': 'fixture-kid'}}))
            with patch('deploy.aws', return_value={'SecretString': 'synthetic-provider-fixture'}), \
                 patch('deploy.subprocess.run', side_effect=cli), patch.dict(os.environ, {'LOCAL_IMAGE_REF': 'fixture-image'}):
                self.assertEqual(deployment.authenticated_proof()['kind'], 'basic-cli-read')
            self.assertFalse((deployment.root / 'credentials').exists())

    def test_quiescence_response_loss_records_intent_and_restores_without_database_launch(self):
        deployment = object.__new__(Deployment)
        deployment.quiesced = False
        deployment.source, deployment.digest, deployment.old_digest = 'source', DIGEST, DIGEST
        deployment.old_task, deployment.new_task, deployment.desired = 'old', None, 1
        deployment.manifest = {'cluster': 'cluster', 'service': 'service'}
        deployment.database_launch_attempted, deployment.database_verified = False, False
        evidence = []
        deployment.file = lambda name, value: evidence.append((name, value))
        deployment.service = lambda: {'taskDefinition': 'old', 'desiredCount': 0}
        deployment.wait_stable = lambda task, digest: evidence.append(('verified', task))
        def lose_response(*args):
            self.assertTrue(deployment.quiesced)
            self.assertEqual(evidence[0][0], 'phase-evidence.json')
            raise TimeoutError('accepted request, lost response')
        with patch('deploy.aws', side_effect=lose_response), self.assertRaises(TimeoutError):
            deployment.quiesce('prefix')
        with patch('deploy.aws') as aws:
            deployment.recover()
            self.assertEqual(aws.call_args.args[-2:], ('--desired-count', '1'))
        self.assertEqual(evidence[-1][1]['status'], 'old_image_restored_verified')

    def test_recovery_never_restarts_service_over_unknown_database_outcome(self):
        deployment = object.__new__(Deployment)
        deployment.quiesced = True
        deployment.old_task = 'old'
        deployment.database_launch_attempted = True
        deployment.database_verified = False
        with patch('deploy.aws') as aws, self.assertRaisesRegex(ValueError, 'DATABASE_OUTCOME_UNPROVEN'):
            deployment.recover()
        aws.assert_not_called()

    def test_recovery_refuses_foreign_service_revision(self):
        deployment = object.__new__(Deployment)
        deployment.quiesced, deployment.old_task, deployment.new_task = True, 'old', 'new'
        deployment.database_launch_attempted, deployment.database_verified = True, True
        deployment.service = lambda: {'taskDefinition': 'foreign', 'desiredCount': 1}
        with patch('deploy.aws') as aws, self.assertRaisesRegex(ValueError, 'RECOVERY_TASK_DRIFT'):
            deployment.recover()
        aws.assert_not_called()

    def test_receipt_requires_versioned_backup_and_equal_complete_integrity(self):
        domain = {'sha256': 'b' * 64, 'tables': [{'table': 'notes', 'count': 1, 'sha256': 'c' * 64}]}
        receipt = {'schema': 'knowledge.database-deploy-receipt.v1', 'success': True, 'source': 'd' * 40,
            'image_digest': DIGEST, 'legacy_owner_mode': 'disabled',
            'backup': {'bucket': 'fixture-backups', 'key': 'prefix/database.dump', 'version_id': 'version', 'sha256': 'e' * 64, 'bytes': 512},
            'integrity': {'pre': domain, 'post': copy.deepcopy(domain)},
            'migration': {'before': {'pending': 0}, 'after': {'pending': 0}}}
        validate_receipt(receipt, 'd' * 40, DIGEST, 'fixture-backups', 'prefix')
        receipt['integrity']['post']['tables'][0]['count'] = 0
        with self.assertRaisesRegex(ValueError, 'DOMAIN_DRIFT'):
            validate_receipt(receipt, 'd' * 40, DIGEST, 'fixture-backups', 'prefix')
        receipt['integrity']['post'] = copy.deepcopy(domain)
        receipt['backup']['version_id'] = 'null'
        with self.assertRaisesRegex(ValueError, 'BACKUP_VERSION'):
            validate_receipt(receipt, 'd' * 40, DIGEST, 'fixture-backups', 'prefix')


if __name__ == '__main__':
    unittest.main()
