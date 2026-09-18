#!/usr/bin/env python3
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

op = load('operations', 'operations.py')
fixture = load('control_fixture', 'control_test.py').fixture


class Operations(unittest.TestCase):
    def test_producer_has_no_migration_credentials_or_parameter_write_surface(self):
        for args in [('ecs', 'run-task'), ('ecs', 'deregister-task-definition'), ('secretsmanager', 'get-secret-value'), ('ssm', 'put-parameter'), ('ssm', 'get-parameter', '--name', '/other')]:
            with self.subTest(args=args), patch.object(op.subprocess, 'run') as execute, self.assertRaises(ValueError):
                op.aws(*args)
            execute.assert_not_called()

    def test_task_body_uses_a_sealed_anonymous_descriptor_and_no_retry(self):
        seen = []
        def execute(argv, **kw):
            self.assertEqual(kw['env']['AWS_MAX_ATTEMPTS'], '1')
            fd, = kw['pass_fds']; target = argv[argv.index('--cli-input-json') + 1]
            self.assertEqual(target, f'file:///proc/self/fd/{fd}')
            value = os.read(fd, 10000); self.assertEqual(json.loads(value), {'synthetic': 'fixture-only'})
            with self.assertRaises(OSError): os.write(fd, b'changed')
            self.assertNotIn('fixture-only', ' '.join(argv)); seen.append(1)
            return subprocess.CompletedProcess(argv, 0, b'{}', b'')
        with patch.object(op.subprocess, 'run', execute):
            op.aws('ecs', 'register-task-definition', body={'synthetic': 'fixture-only'})
        self.assertEqual(seen, [1])

    def candidate(self, cfg, candidate):
        source = candidate['source_commit']; run = candidate['candidate_run_id']
        candidate.update(schema='hasna.calendar-candidate.v1', candidate_run_attempt=1,
            image_tag=f'candidate-{source}-{run}-1', platform='linux/arm64', smoke_proof_sha256='6' * 64,
            vulnerability_report_sha256='7' * 64,
            migration_0003_sha256=hashlib.sha256((op.c.ROOT / 'apps/calendar/migrations/0003_tenant_boundary.sql').read_bytes()).hexdigest())
        raw = op.c.encode(candidate) + b'\n'; sha = hashlib.sha256(raw).hexdigest()
        cfg['activation_receipt']['candidate_receipt_sha256'] = sha
        cfg['activation_receipt']['migration_0003_sha256'] = candidate['migration_0003_sha256']
        cfg['activation_receipt']['recorded_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        return raw, sha

    def test_null_activation_refuses_before_any_write(self):
        cfg, candidate, service, task = fixture(); raw, sha = self.candidate(cfg, candidate)
        cfg['activation_receipt'] = None
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'candidate.json'; path.write_bytes(raw)
            with patch.object(op.g, 'current_main'), patch.object(op, 'read_manifest', return_value=cfg), patch.object(op, 'state', return_value=(service, task, {}, [])), patch.object(op, 'aws') as aws:
                with self.assertRaisesRegex(ValueError, 'ACTIVATION_RECEIPT_REQUIRED'):
                    op.promote(candidate['source_commit'], path, sha, Path(temp) / 'out')
                aws.assert_not_called()

    def promotion(self, fail_update=False, drift=False, omitted=False, invalid_eligibility=False):
        cfg, candidate, service, task = fixture(); raw, sha = self.candidate(cfg, candidate)
        if omitted:
            del task['requiresCompatibilities']
            task['compatibilities'] = ['EC2', 'FARGATE', 'MANAGED_INSTANCES']
        desired = op.c.task_payload(task); desired['containerDefinitions'][0]['image'] = cfg['ecr_repository_url'] + '@' + candidate['image_digest']
        arn = service['taskDefinition'].rsplit(':', 1)[0] + ':43'
        live = copy.deepcopy(service); live['taskDefinition'] = arn; live['deployments'][0]['taskDefinition'] = arn
        live['desiredCount'] = 1; live['runningCount'] = 1
        calls = []
        def aws(*args, body=None):
            calls.append((args, body))
            if args[:2] == ('ecs', 'register-task-definition'):
                restored = copy.deepcopy(body); restored['containerDefinitions'][0]['image'] = task['containerDefinitions'][0]['image']
                self.assertEqual(restored, op.c.task_payload(task))
                return {'taskDefinition': {'taskDefinitionArn': arn}}
            if args[:2] == ('ecs', 'update-service'):
                self.assertEqual(args[-2:], ('--desired-count', '1'))
                if fail_update: raise ValueError('AWS_REFUSED_OR_UNCERTAIN:ecs/update-service')
                return {}
            raise AssertionError('unexpected mutation')
        admits = [(cfg, service, task), ValueError('ACTIVATION_LIVE_DRIFT') if drift else (cfg, service, task)]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'candidate.json'; path.write_bytes(raw); out = Path(temp) / 'out'
            with patch.object(op, 'fresh_admission', side_effect=admits) as fresh, patch.object(op, 'aws', aws), patch.object(op, 'read_task', return_value={**desired, 'compatibilities': ['EC2'] if invalid_eligibility else ['EC2', 'FARGATE', 'MANAGED_INSTANCES']}), patch.object(op, 'read_service', return_value=live), patch.object(op, 'read_manifest', return_value=cfg), patch.object(op, 'running', return_value=['8' * 64]):
                if drift or fail_update or invalid_eligibility:
                    with self.assertRaises(ValueError): op.promote(candidate['source_commit'], path, sha, out)
                else:
                    op.promote(candidate['source_commit'], path, sha, out)
                    receipt = json.loads((out / 'deployed.json').read_bytes())
                    self.assertIs(receipt['automatic_rollback'], False)
                    self.assertIs(receipt['migration_performed'], False)
                self.assertEqual(fresh.call_count, 1 if invalid_eligibility else 2)
                if invalid_eligibility:
                    refusal = json.loads((out / 'reconciliation-required.json').read_bytes())
                    self.assertEqual(refusal['phase'], 'registration')
                if fail_update:
                    refusal = json.loads((out / 'reconciliation-required.json').read_bytes())
                    self.assertIs(refusal['automatic_retry'], False)
            self.assertEqual(sum(args[:2] == ('ecs', 'register-task-definition') for args, _ in calls), 1)
            self.assertEqual(sum(args[:2] == ('ecs', 'update-service') for args, _ in calls), 0 if drift or invalid_eligibility else 1)

    def test_success_changes_only_image_after_two_fresh_admissions(self): self.promotion()
    def test_promotion_preserves_omitted_compatibility_declaration(self): self.promotion(omitted=True)
    def test_registered_omitted_declaration_requires_fresh_computed_eligibility(self): self.promotion(omitted=True, invalid_eligibility=True)
    def test_preupdate_drift_prevents_service_mutation(self): self.promotion(drift=True)
    def test_uncertain_update_records_refusal_without_retry_or_rollback(self): self.promotion(fail_update=True)

    def test_actual_aws_shape_requires_fargate_service_and_running_evidence(self):
        cfg, _, service, task = fixture()
        service.update(desiredCount=1, runningCount=1)
        del task['requiresCompatibilities']
        task['compatibilities'] = ['EC2', 'FARGATE', 'MANAGED_INSTANCES']
        live = {'taskArn': 'synthetic-task', 'clusterArn': service['clusterArn'],
            'taskDefinitionArn': service['taskDefinition'], 'lastStatus': 'RUNNING',
            'healthStatus': 'HEALTHY', 'launchType': 'FARGATE', 'capacityProviderName': 'FARGATE_SPOT', 'containers': [{'name': 'calendar',
            'lastStatus': 'RUNNING', 'imageDigest': 'sha256:' + 'a' * 64}]}
        for launch in ['FARGATE', 'EC2', None, 'UNKNOWN']:
            with self.subTest(launch=launch), patch.object(op, 'read_service', return_value=service), patch.object(op, 'read_task', return_value=task), patch.object(op, 'aws', side_effect=[{'taskArns': ['synthetic-task']}, {'tasks': [{**live, 'launchType': launch}]}]):
                if launch == 'FARGATE':
                    _, returned, baseline, observed = op.state(cfg)
                    self.assertNotIn('requiresCompatibilities', returned)
                    self.assertEqual(baseline['task_payload_sha256'], op.c.digest(op.c.task_payload(task)))
                    self.assertEqual(len(observed), 1)
                else:
                    with self.assertRaisesRegex(ValueError, 'RUNNING_TASK_FARGATE'): op.state(cfg)
        for provider in ['EC2', None, 'UNKNOWN']:
            with self.subTest(provider=provider), patch.object(op, 'read_service', return_value=service), patch.object(op, 'read_task', return_value=task), patch.object(op, 'aws', side_effect=[{'taskArns': ['synthetic-task']}, {'tasks': [{**live, 'capacityProviderName': provider}]}]):
                with self.assertRaisesRegex(ValueError, 'RUNNING_TASK_CAPACITY_PROVIDER'): op.state(cfg)
        for launch in ['EC2', None, 'UNKNOWN']:
            with self.subTest(service_launch=launch), patch.object(op, 'read_service', return_value={**service, 'launchType': launch}), patch.object(op, 'read_task') as read:
                with self.assertRaisesRegex(ValueError, 'SERVICE_FARGATE'): op.state(cfg)
                read.assert_not_called()

    def test_omitted_declaration_still_allows_verified_quiescence(self):
        cfg, _, service, task = fixture()
        del task['requiresCompatibilities']
        task['compatibilities'] = ['EC2', 'FARGATE', 'MANAGED_INSTANCES']
        with patch.object(op, 'read_service', return_value=service), patch.object(op, 'read_task', return_value=task), patch.object(op, 'aws', side_effect=[{'taskArns': []}, {'taskArns': []}]):
            _, _, baseline, observed = op.state(cfg, activate=True)
            self.assertEqual(baseline['desired_count'], 0)
            self.assertEqual(observed, [])

    def test_prepare_eligibility_refusal_precedes_registry_or_docker_write(self):
        cfg, candidate, service, task = fixture()
        del task['requiresCompatibilities']
        task['compatibilities'] = ['EC2']
        source = candidate['source_commit']; image = 'calendar-candidate:' + source
        proof = {'schema': 'hasna.calendar-container-smoke.v1', 'image_id': 'synthetic-image',
            'platform': 'linux/arm64', 'version': json.loads((op.c.ROOT / 'apps/calendar/package.json').read_bytes())['version'],
            'cpus': '0.25', 'memory_mib': 512, 'port': 8080, 'migration_runs': 2,
            'tls_verify_full': True, 'owned_record_read': 200, 'cross_tenant_read': 404,
            'authentication_controls_passed': True, 'offline_version_passed': True}
        with tempfile.TemporaryDirectory() as temp:
            smoke = Path(temp) / 'smoke.json'; smoke.write_bytes(op.c.encode(proof)); out = Path(temp) / 'out'
            with patch.object(op.g, 'current_main'), patch.object(op, 'scan_report', return_value='1' * 64), patch.object(op, 'local_image', return_value=('synthetic-image', candidate['image_config_digest'])), patch.object(op, 'read_manifest', return_value=cfg), patch.object(op, 'read_service', return_value=service), patch.object(op, 'read_task', return_value=task), patch.object(op, 'aws') as aws, patch.object(op.g, 'command') as execute:
                with self.assertRaisesRegex(ValueError, 'TASK_FARGATE_ELIGIBILITY'):
                    op.prepare(source, image, Path(temp) / 'scan.json', smoke, out)
                aws.assert_not_called(); execute.assert_not_called(); self.assertFalse(out.exists())

    def test_scanner_requires_real_complete_image_report(self):
        image = 'calendar-candidate:' + 'a' * 40
        base = {'SchemaVersion': 2, 'ArtifactName': image, 'ArtifactType': 'container_image', 'Metadata': {'OS': {'Family': 'alpine'}}, 'Results': [{'Target': 'Alpine', 'Vulnerabilities': []}]}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'scan.json'; path.write_text(json.dumps(base)); op.scan_report(path, image)
            for mutation in [lambda r: r.update(Results=[]), lambda r: r.update(ArtifactName='other'), lambda r: r['Results'][0].update(Vulnerabilities=[{'Severity': 'HIGH'}]), lambda r: r['Results'][0].update(Vulnerabilities=[{'Severity': 'UNKNOWN'}]), lambda r: r['Results'][0].update(Vulnerabilities={})]:
                value = copy.deepcopy(base); mutation(value); path.write_text(json.dumps(value))
                with self.assertRaises(ValueError): op.scan_report(path, image)

    def test_oci_index_resolves_exact_arm64_child_and_config(self):
        child = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'config': {'digest': 'sha256:' + 'a' * 64}, 'layers': [{'digest': 'sha256:' + 'b' * 64}]}
        raw = op.c.encode(child); child_sha = 'sha256:' + hashlib.sha256(raw).hexdigest()
        descriptor = {'digest': child_sha, 'size': len(raw), 'mediaType': child['mediaType'], 'platform': {'os': 'linux', 'architecture': 'arm64'}}
        index = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json', 'manifests': [descriptor, {'digest': 'sha256:' + 'c' * 64, 'platform': {'os': 'unknown', 'architecture': 'unknown'}}]}
        def response(value):
            data = op.c.encode(value)
            return {'images': [{'imageId': {'imageDigest': 'sha256:' + hashlib.sha256(data).hexdigest()}, 'imageManifest': data.decode()}]}
        with patch.object(op, 'aws', side_effect=[response(index), response(child)]):
            self.assertEqual(op.ecr_manifest({}, 'imageTag=fixture'), (child_sha, child['config']['digest']))
        duplicate = copy.deepcopy(index); duplicate['manifests'].append(descriptor)
        with patch.object(op, 'aws', return_value=response(duplicate)), self.assertRaisesRegex(ValueError, 'ECR_ARM64_MANIFEST_COUNT'):
            op.ecr_manifest({}, 'imageTag=fixture')
        bad = copy.deepcopy(index); bad['manifests'][0]['size'] += 1
        with patch.object(op, 'aws', side_effect=[response(bad), response(child)]), self.assertRaisesRegex(ValueError, 'ECR_DESCRIPTOR_DRIFT'):
            op.ecr_manifest({}, 'imageTag=fixture')

    def test_ecr_scan_missing_malformed_or_wrong_digest_refuses(self):
        sha = 'sha256:' + 'a' * 64
        good = {'imageId': {'imageDigest': sha}, 'imageScanStatus': {'status': 'COMPLETE'}, 'imageScanFindings': {'findingSeverityCounts': {}}}
        with patch.object(op, 'aws', return_value=good): op.ecr_scan(sha)
        for change in [{'imageId': {'imageDigest': 'sha256:' + 'b' * 64}}, {'imageScanFindings': {}}, {'imageScanFindings': {'findingSeverityCounts': {'HIGH': True}}}, {'imageScanFindings': {'findingSeverityCounts': {'CRITICAL': 1}}}, {'imageScanStatus': {'status': 'IN_PROGRESS'}}]:
            with patch.object(op, 'aws', return_value={**good, **change}), self.assertRaises(ValueError): op.ecr_scan(sha)


    def test_admission_rechecks_expiry_and_fixed_authority_after_registry_reads(self):
        cfg, candidate, service, task = fixture(); _, sha = self.candidate(cfg, candidate)
        original = copy.deepcopy(cfg)
        def slow_scan(*args): cfg['activation_receipt']['recorded_at'] = '2000-01-01T00:00:00Z'
        with patch.object(op.g, 'current_main'), patch.object(op, 'read_manifest', return_value=cfg), patch.object(op, 'state', return_value=(service, task, {}, [])), patch.object(op, 'ecr_manifest', return_value=(candidate['image_digest'], candidate['image_config_digest'])), patch.object(op, 'ecr_scan', side_effect=slow_scan):
            with self.assertRaises(ValueError): op.fresh_admission(candidate['source_commit'], candidate, sha)
        changed = copy.deepcopy(original); changed['activation_receipt'] = None
        with patch.object(op.g, 'current_main'), patch.object(op, 'read_manifest', side_effect=[original, changed]), patch.object(op, 'state', return_value=(service, task, {}, [])), patch.object(op, 'ecr_manifest', return_value=(candidate['image_digest'], candidate['image_config_digest'])), patch.object(op, 'ecr_scan'):
            with self.assertRaises(ValueError): op.fresh_admission(candidate['source_commit'], candidate, sha)

    def test_reconcile_retains_unstable_rollout_without_claiming_running_proof(self):
        for rollout in ['IN_PROGRESS', 'FAILED']:
            cfg, candidate, service, task = fixture()
            service['deployments'][0]['rolloutState'] = rollout
            with tempfile.TemporaryDirectory() as temp, patch.object(op.g, 'current_main'), patch.object(op, 'read_manifest', return_value=cfg), patch.object(op, 'read_service', return_value=service), patch.object(op, 'read_task', return_value=task), patch.object(op, 'running') as running:
                op.reconcile(candidate['source_commit'], Path(temp))
                receipt = json.loads((Path(temp) / 'reconciled.json').read_bytes())
                self.assertFalse(receipt['stable_running_state_verified'])
                self.assertEqual(receipt['rollout_states'], [rollout])
                self.assertEqual(receipt['production_mutations'], 0)
                self.assertEqual(receipt['baseline_sha256'], op.c.digest(op.c.baseline(service, task, cfg, stable=False)))
                running.assert_not_called()

    def test_quiescence_checks_stopping_tasks_beyond_zero_service_counters(self):
        cfg, _, service, task = fixture()
        recent = {'taskArn': 'synthetic-task', 'clusterArn': service['clusterArn'], 'group': 'service:' + cfg['service'], 'lastStatus': 'STOPPED'}
        with patch.object(op, 'aws', side_effect=[{'taskArns': []}, {'taskArns': ['synthetic-task']}, {'tasks': [recent]}]):
            self.assertEqual(op.running(cfg, service, 'sha256:' + 'a' * 64), [])
        for status in ['RUNNING', 'STOPPING', 'DEACTIVATING']:
            with patch.object(op, 'aws', side_effect=[{'taskArns': []}, {'taskArns': ['synthetic-task']}, {'tasks': [{**recent, 'lastStatus': status}]}]), self.assertRaisesRegex(ValueError, 'OLD_WRITER_NOT_STOPPED'):
                op.running(cfg, service, 'sha256:' + 'a' * 64)

if __name__ == '__main__': unittest.main()
