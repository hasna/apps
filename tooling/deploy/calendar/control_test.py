#!/usr/bin/env python3
import copy
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('control', Path(__file__).with_name('control.py'))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class Boundaries(unittest.TestCase):
    def test_canonical_manifest_hash_excludes_only_activation(self):
        left = {'z': {'b': 2, 'a': 'café'}, 'a': True, 'activation_receipt': None}
        right = {'activation_receipt': {'private': 'receipt'}, 'a': True, 'z': {'a': 'café', 'b': 2}}
        self.assertEqual(control.configuration_digest(left), control.configuration_digest(right))
        self.assertEqual(control.encode({'z': 2, 'a': {'b': 'café', 'a': True}}), b'{"a":{"a":true,"b":"caf\xc3\xa9"},"z":2}')
        right['z']['a'] = 'changed'
        self.assertNotEqual(control.configuration_digest(left), control.configuration_digest(right))

    def test_duplicate_keys_are_refused(self):
        with self.assertRaises(ValueError):
            control.decode(b'{"source":"a","source":"b"}')

    def test_existing_ecs_automatic_rollback_is_not_a_safe_baseline(self):
        for config in [
            {'deploymentCircuitBreaker': {'enable': True, 'rollback': True}},
            {'deploymentCircuitBreaker': {'enable': True, 'rollback': False}, 'alarms': {'enable': True, 'rollback': True}},
            {'deploymentCircuitBreaker': {'enable': True, 'rollback': False}, 'lifecycleHooks': [{'fixture': 'hook'}]},
            {'deploymentCircuitBreaker': {'enable': True, 'rollback': False}, 'strategy': 'BLUE_GREEN'},
            {},
        ]:
            with self.assertRaises(ValueError): control.rollback_disabled({'deploymentConfiguration': config})
        control.rollback_disabled({'deploymentConfiguration': {
            'deploymentCircuitBreaker': {'enable': True, 'rollback': False},
            'strategy': 'ROLLING', 'bakeTimeInMinutes': 0,
            'resetOnHealthyTask': True, 'thresholdConfiguration': {'value': 50},
        }})

    def test_task_registration_uses_an_explicit_input_allowlist(self):
        current = {'family': 'calendar-prod', 'containerDefinitions': [], 'cpu': '256', 'memory': '512',
                   'taskDefinitionArn': 'metadata', 'revision': 42, 'futureReadOnlyMetadata': 'not an input'}
        self.assertEqual(control.task_payload(current), {'family': 'calendar-prod', 'containerDefinitions': [], 'cpu': '256', 'memory': '512'})

    def test_receipt_age_is_short_bounded_and_never_a_future_attestation(self):
        now = datetime(2026, 9, 18, 12, tzinfo=timezone.utc)
        control.receipt_time({'recorded_at': '2026-09-18T11:00:00Z', 'max_age_seconds': 3600}, now)
        for receipt in [
            {'recorded_at': '2026-09-18T11:00:00Z', 'max_age_seconds': 3599},
            {'recorded_at': '2026-09-18T12:00:01Z', 'max_age_seconds': 3600},
            {'recorded_at': '2026-09-18T12:00:00Z', 'max_age_seconds': 86401},
            {'recorded_at': '2026-09-18T12:00:00Z', 'max_age_seconds': True},
        ]:
            with self.assertRaises(ValueError): control.receipt_time(receipt, now)



# Synthetic complete activation fixture: no live identifiers or credentials.
def fixture():
    account = '1' * 12
    cfg = {'schema': 'hasna.calendar-deploy.v1', 'app': 'calendar', 'region': 'us-east-1',
        'account_id': account, 'cluster': 'fixture', 'service': 'calendar-prod',
        'web_task_family': 'calendar-prod', 'web_container': 'calendar',
        'ecr_repository_url': f'{account}.dkr.ecr.us-east-1.amazonaws.com/calendar',
        'image_platform': 'linux/arm64', 'public_base_url': 'https://api.hasna.com/calendar',
        'health_url': 'https://api.hasna.com/calendar/health', 'execution_role_arn': f'arn:aws:iam::{account}:role/fixture',
        'task_role_arn': None, 'task_cpu': '256', 'task_memory': '512', 'container_port': 8080,
        'subnets': ['subnet-12345678'], 'security_groups': ['sg-12345678'], 'assign_public_ip': 'ENABLED',
        'log_group': '/ecs/fixture', 'log_stream_prefix': 'service', 'web_environment': {'PORT': '8080'},
        'web_secrets': {k: f'arn:aws:secretsmanager:us-east-1:{account}:secret:fixture/{k}' for k in ['HASNA_CALENDAR_DATABASE_URL', 'HASNA_CALENDAR_API_SIGNING_KEY']},
        'activation_requires_reviewed_tenant_enrollment': True, 'producer_migration_allowed': False,
        'automatic_rollback_to_unscoped_runtime_allowed': False, 'activation_receipt': None}
    arn = f'arn:aws:ecs:us-east-1:{account}:task-definition/calendar-prod:42'
    service = {'clusterArn': f'arn:aws:ecs:us-east-1:{account}:cluster/fixture',
        'serviceArn': f'arn:aws:ecs:us-east-1:{account}:service/fixture/calendar-prod',
        'serviceName': 'calendar-prod', 'status': 'ACTIVE', 'taskDefinition': arn,
        'desiredCount': 0, 'runningCount': 0, 'pendingCount': 0,
        'deployments': [{'status': 'PRIMARY', 'rolloutState': 'COMPLETED', 'taskDefinition': arn}],
        'networkConfiguration': {'awsvpcConfiguration': {'subnets': cfg['subnets'], 'securityGroups': cfg['security_groups'], 'assignPublicIp': 'ENABLED'}},
        'deploymentConfiguration': {'deploymentCircuitBreaker': {'enable': True, 'rollback': False}}}
    task = {'taskDefinitionArn': arn, 'family': 'calendar-prod', 'cpu': '256', 'memory': '512',
        'executionRoleArn': cfg['execution_role_arn'], 'networkMode': 'awsvpc', 'requiresCompatibilities': ['FARGATE'],
        'runtimePlatform': {'cpuArchitecture': 'ARM64', 'operatingSystemFamily': 'LINUX'},
        'containerDefinitions': [{'name': 'calendar', 'essential': True, 'image': cfg['ecr_repository_url'] + '@sha256:' + 'a' * 64,
            'environment': [{'name': k, 'value': v} for k, v in cfg['web_environment'].items()],
            'secrets': [{'name': k, 'valueFrom': v} for k, v in cfg['web_secrets'].items()],
            'portMappings': [{'containerPort': 8080, 'hostPort': 8080, 'protocol': 'tcp'}],
            'logConfiguration': {'logDriver': 'awslogs', 'options': {'awslogs-group': '/ecs/fixture', 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'service'}}}]}
    candidate = {'source_commit': 'b' * 40, 'candidate_run_id': '100', 'image_digest': 'sha256:' + 'c' * 64,
        'image_config_digest': 'sha256:' + 'd' * 64, 'manifest_configuration_sha256': control.configuration_digest(cfg), 'migration_0003_sha256': 'e' * 64}
    receipt = {'schema': 'hasna.calendar-activation.v1', 'recorded_at': '2026-09-18T12:00:00Z', 'max_age_seconds': 3600,
        **candidate, 'candidate_receipt_sha256': 'f' * 64, 'baseline': control.baseline(service, task, cfg),
        'tenant_id': 'fixture-tenant', 'automatic_rollback_allowed': False,
        'pre_quiesce_baseline_sha256': '6' * 64, 'pre_quiesce_desired_count': 1, 'target_desired_count': 1,
        'quiescence_proof_sha256': '7' * 64,
        'ownership': {'state': 'assigned', 'census_sha256': '1' * 64, 'assignment_proof_sha256': '2' * 64},
        'credentials': {'state': 'verified', 'signed_claims_verified': True, 'current_readback_verified': True, 'proof_sha256': '3' * 64},
        'candidate_proof': {'state': 'passed', 'traffic_closed': True, 'owned_record_sha256': '4' * 64, 'proof_sha256': '5' * 64,
            'controls': {'owned': 200, 'missing': 401, 'invalid': 401, 'untenanted': 403, 'unknown': 403, 'disabled': 403, 'cross_tenant': 404}}}
    cfg['activation_receipt'] = receipt
    return cfg, candidate, service, task


class CompleteActivation(unittest.TestCase):
    def admit(self, cfg, candidate, service, task):
        return control.activation(cfg, candidate, 'f' * 64, service, task, datetime(2026, 9, 18, 12, 1, tzinfo=timezone.utc))

    def test_complete_receipt_and_standard_ssm_bound(self):
        cfg, candidate, service, task = fixture()
        control.manifest(cfg)
        self.admit(cfg, candidate, service, task)
        self.assertLessEqual(len(control.encode(cfg)), 4096)
        cfg['web_environment']['EXTRA'] = 'x' * 4096
        with self.assertRaises(ValueError): control.manifest(cfg)

    def test_rejects_null_authority_and_each_proof_bypass(self):
        for mutation in [lambda c: c.update(activation_receipt=None),
            lambda c: c['activation_receipt']['credentials'].update(signed_claims_verified=False),
            lambda c: c['activation_receipt']['candidate_proof']['controls'].update(owned=200.0),
            lambda c: c['activation_receipt']['baseline'].update(desired_count=True)]:
            cfg, candidate, service, task = fixture(); mutation(cfg)
            with self.assertRaises(ValueError): self.admit(cfg, candidate, service, task)

    def test_rejects_every_reviewed_service_configuration_drift(self):
        for field in ['serviceConnectConfiguration', 'vpcLatticeConfigurations', 'volumeConfigurations',
                      'healthCheckGracePeriodSeconds', 'placementConstraints', 'placementStrategy',
                      'availabilityZoneRebalancing', 'enableECSManagedTags', 'propagateTags']:
            cfg, candidate, service, task = fixture(); service[field] = 'changed'
            with self.subTest(field=field), self.assertRaises(ValueError): self.admit(cfg, candidate, service, task)

    def test_binds_exact_cluster_and_referenced_task(self):
        cfg, candidate, service, task = fixture(); task['taskDefinitionArn'] += '1'
        with self.assertRaises(ValueError): self.admit(cfg, candidate, service, task)
        cfg, candidate, service, task = fixture(); service['clusterArn'] += '-other'
        with self.assertRaises(ValueError): control.validate_service(service, cfg)

    def test_binds_primary_deployment_routing_and_volume_configuration(self):
        for key in ['serviceConnectConfiguration', 'vpcLatticeConfigurations', 'volumeConfigurations']:
            cfg, candidate, service, task = fixture()
            service['deployments'][0][key] = {'fixture': 'changed'}
            with self.subTest(key=key), self.assertRaises(ValueError): self.admit(cfg, candidate, service, task)

    def test_canonical_profile_rejects_js_ambiguous_numbers_and_keys(self):
        for value in [{'10': 'a', '2': 'b'}, {'n': 9007199254740993}, {'n': 1.0}]:
            with self.assertRaises(ValueError): control.encode(value)

    def test_activation_requires_quiescence_and_exact_reviewed_restoration(self):
        for mutate in [lambda c, s: s.update(desiredCount=1, runningCount=1),
            lambda c, s: c['activation_receipt'].update(target_desired_count=2),
            lambda c, s: c['activation_receipt'].update(pre_quiesce_desired_count=True),
            lambda c, s: c['activation_receipt'].update(quiescence_proof_sha256='')]:
            cfg, candidate, service, task = fixture(); mutate(cfg, service)
            cfg['activation_receipt']['baseline'] = control.baseline(service, task, cfg)
            with self.assertRaises(ValueError): self.admit(cfg, candidate, service, task)

if __name__ == '__main__': unittest.main()
