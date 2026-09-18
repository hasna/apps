#!/usr/bin/env python3
"""Prepare/read/reconcile/promote Calendar. Never migrate, enroll, or roll back."""
import argparse
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time

spec = importlib.util.spec_from_file_location('calendar_gate', Path(__file__).with_name('gate.py'))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
c = g.c


AWS_OPERATIONS = {('sts', 'get-caller-identity'), ('ssm', 'get-parameter'),
    ('ecs', 'describe-services'), ('ecs', 'describe-task-definition'), ('ecs', 'list-tasks'),
    ('ecs', 'describe-tasks'), ('ecs', 'register-task-definition'), ('ecs', 'update-service'),
    ('ecr', 'batch-get-image'), ('ecr', 'describe-image-scan-findings')}


def aws(*args, body=None):
    c.require(tuple(args[:2]) in AWS_OPERATIONS, 'AWS_OPERATION_NOT_ADMITTED')
    if args[:2] == ('ssm', 'get-parameter'):
        c.require(args == ('ssm', 'get-parameter', '--name', c.PARAMETER), 'SSM_READ_BOUNDARY')
    c.require(body is None or args == ('ecs', 'register-task-definition'), 'AWS_BODY_BOUNDARY')
    env = {**os.environ, 'AWS_MAX_ATTEMPTS': '1', 'AWS_PAGER': ''}
    argv = ['aws', '--region', c.REGION, '--output', 'json', '--no-cli-pager', *args]
    fd = None
    try:
        if body is not None:
            raw = c.encode(body)
            c.require(len(raw) <= 1024 * 1024, 'AWS_REQUEST_SIZE')
            fd = os.memfd_create('calendar-aws-request', os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
            os.fchmod(fd, 0o600)
            pending = memoryview(raw)
            while pending:
                written = os.write(fd, pending); c.require(written > 0, 'AWS_REQUEST_WRITE'); pending = pending[written:]
            os.lseek(fd, 0, os.SEEK_SET)
            seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
            fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)
            c.require(fcntl.fcntl(fd, fcntl.F_GET_SEALS) == seals, 'AWS_REQUEST_SEAL')
            argv += ['--cli-input-json', f'file:///proc/self/fd/{fd}']
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=120,
            env=env, pass_fds=() if fd is None else (fd,))
    finally:
        if fd is not None: os.close(fd)
    c.require(result.returncode == 0, 'AWS_REFUSED_OR_UNCERTAIN:' + '/'.join(args[:2]))
    c.require(len(result.stdout) <= 8 * 1024 * 1024, 'AWS_RESPONSE_SIZE')
    return c.decode(result.stdout or b'{}')


def read_manifest():
    parameter = aws('ssm', 'get-parameter', '--name', c.PARAMETER).get('Parameter', {})
    c.require(parameter.get('Name') == c.PARAMETER and parameter.get('Type') == 'String', 'SSM_PARAMETER_IDENTITY')
    raw = parameter.get('Value')
    c.require(isinstance(raw, str) and len(raw.encode('utf-8')) <= 4096, 'SSM_PARAMETER_SIZE')
    value = c.manifest(c.decode(raw))
    c.require(aws('sts', 'get-caller-identity').get('Account') == value['account_id'], 'AWS_ACCOUNT')
    return value


def read_service(config):
    result = aws('ecs', 'describe-services', '--cluster', config['cluster'], '--services', config['service'])
    c.require(not result.get('failures') and len(result.get('services', [])) == 1, 'SERVICE_READ')
    return result['services'][0]


def read_task(arn):
    value = aws('ecs', 'describe-task-definition', '--task-definition', arn, '--include', 'TAGS')
    return {**value['taskDefinition'], 'tags': value.get('tags', [])}


def running(config, service, image_digest):
    result = aws('ecs', 'list-tasks', '--cluster', config['cluster'], '--service-name', config['service'], '--desired-status', 'RUNNING')
    arns = result.get('taskArns')
    c.require(isinstance(arns, list) and len(arns) == service['desiredCount'] and len(arns) <= 100 and len(set(arns)) == len(arns) and not result.get('nextToken'), 'RUNNING_TASK_COUNT')
    if not arns:
        # Desired STOPPED tasks can still be STOPPING and executing writes.
        # Inspect the bounded recent set rather than trusting service counters.
        stopped = aws('ecs', 'list-tasks', '--cluster', config['cluster'], '--service-name', config['service'], '--desired-status', 'STOPPED')
        recent = stopped.get('taskArns')
        c.require(isinstance(recent, list) and len(recent) <= 100 and len(set(recent)) == len(recent) and not stopped.get('nextToken'), 'QUIESCENCE_TASK_SET')
        if recent:
            rows = aws('ecs', 'describe-tasks', '--cluster', config['cluster'], '--tasks', *recent)
            tasks = rows.get('tasks', [])
            c.require(not rows.get('failures') and {row.get('taskArn') for row in tasks} == set(recent) and len(tasks) == len(recent), 'QUIESCENCE_TASK_READ')
            c.require(all(row.get('clusterArn') == service['clusterArn'] and row.get('group') == 'service:' + config['service'] and row.get('lastStatus') == 'STOPPED' for row in tasks), 'OLD_WRITER_NOT_STOPPED')
        return []
    rows = aws('ecs', 'describe-tasks', '--cluster', config['cluster'], '--tasks', *arns)
    c.require(not rows.get('failures') and len(rows.get('tasks', [])) == len(arns), 'RUNNING_TASK_READ')
    verified = []
    for task in rows['tasks']:
        c.require(task.get('launchType') == 'FARGATE', 'RUNNING_TASK_FARGATE')
        providers = c.fargate_capacity(service)
        c.require(task.get('capacityProviderName') in providers if providers else 'capacityProviderName' not in task, 'RUNNING_TASK_CAPACITY_PROVIDER')
        web = [v for v in task.get('containers', []) if v.get('name') == config['web_container']]
        c.require(task.get('taskArn') in arns and task.get('clusterArn') == service['clusterArn']
            and task.get('taskDefinitionArn') == service['taskDefinition'] and task.get('lastStatus') == 'RUNNING'
            and len(web) == 1 and web[0].get('imageDigest') == image_digest, 'RUNNING_TASK_DRIFT')
        c.require(task.get('healthStatus') in ('HEALTHY', 'UNKNOWN') and web[0].get('lastStatus') == 'RUNNING', 'RUNNING_TASK_HEALTH')
        verified.append(hashlib.sha256(task['taskArn'].encode()).hexdigest())
    c.require(len(set(verified)) == len(arns), 'RUNNING_TASK_DUPLICATE')
    return sorted(verified)


def state(config, activate=False):
    service = read_service(config)
    arn = c.validate_service(service, config, activation=activate)
    task = read_task(arn)
    baseline = c.baseline(service, task, config)
    observed = running(config, service, baseline['image_digest'])
    return service, task, baseline, observed


def save(directory, name, value):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / name
    with path.open('xb') as f:
        os.fchmod(f.fileno(), 0o600); f.write(c.encode(value) + b'\n'); f.flush(); os.fsync(f.fileno())
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scan_report(path, expected_image):
    c.require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 32 * 1024 * 1024, 'SCAN_REPORT_FILE')
    raw = path.read_bytes(); report = c.decode(raw)
    c.require(report.get('SchemaVersion') == 2 and report.get('ArtifactName') == expected_image and report.get('ArtifactType') == 'container_image', 'SCAN_REPORT_IDENTITY')
    rows = report.get('Results')
    c.require(isinstance(rows, list) and len(rows) > 0 and report.get('Metadata', {}).get('OS', {}).get('Family') == 'alpine', 'SCAN_REPORT_COMPLETE')
    for row in rows:
        c.require(isinstance(row, dict) and isinstance(row.get('Target'), str), 'SCAN_RESULT')
        vulnerabilities = row.get('Vulnerabilities', [])
        c.require(isinstance(vulnerabilities, list), 'SCAN_VULNERABILITIES')
        for item in vulnerabilities:
            c.require(isinstance(item, dict) and item.get('Severity') in ('LOW', 'MEDIUM'), 'SCAN_HIGH_CRITICAL_OR_UNKNOWN')
    return hashlib.sha256(raw).hexdigest()


def ecr_manifest(config, image_id, depth=0, expected_descriptor=None):
    c.require(depth <= 1, 'ECR_INDEX_DEPTH')
    result = aws('ecr', 'batch-get-image', '--repository-name', 'calendar', '--image-ids', image_id)
    c.require(not result.get('failures') and len(result.get('images', [])) == 1, 'ECR_IMAGE_READ')
    row = result['images'][0]; raw = row.get('imageManifest', '').encode()
    digest = c.image_sha(row['imageId']['imageDigest'])
    c.require('sha256:' + hashlib.sha256(raw).hexdigest() == digest, 'ECR_MANIFEST_DIGEST')
    if image_id.startswith('imageDigest='):
        c.require(digest == image_id.split('=', 1)[1], 'ECR_REQUESTED_DIGEST')
    if expected_descriptor is not None:
        c.require(digest == expected_descriptor['digest'] and len(raw) == expected_descriptor['size'], 'ECR_DESCRIPTOR_DRIFT')
    value = c.decode(raw)
    c.require(value.get('schemaVersion') == 2, 'ECR_MANIFEST_SCHEMA')
    media = value.get('mediaType')
    if media in ('application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'):
        c.require(depth == 0 and isinstance(value.get('manifests'), list) and 1 <= len(value['manifests']) <= 16, 'ECR_INDEX_SHAPE')
        arms = [row for row in value['manifests'] if row.get('platform', {}).get('os') == 'linux' and row.get('platform', {}).get('architecture') == 'arm64' and row.get('platform', {}).get('variant', 'v8') == 'v8']
        c.require(len(arms) == 1, 'ECR_ARM64_MANIFEST_COUNT')
        descriptor = arms[0]; c.image_sha(descriptor.get('digest'))
        c.require(type(descriptor.get('size')) is int and 0 < descriptor['size'] <= 1024 * 1024 and descriptor.get('mediaType') in ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'), 'ECR_ARM64_DESCRIPTOR')
        return ecr_manifest(config, 'imageDigest=' + descriptor['digest'], depth + 1, descriptor)
    c.require(media in ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'), 'ECR_IMAGE_MANIFEST_REQUIRED')
    config_digest = c.image_sha(value.get('config', {}).get('digest'))
    c.require(isinstance(value.get('layers'), list) and 1 <= len(value['layers']) <= 100, 'ECR_LAYER_SET')
    return digest, config_digest


def ecr_scan(digest, wait=False):
    deadline = time.monotonic() + (600 if wait else 0)
    while True:
        value = aws('ecr', 'describe-image-scan-findings', '--repository-name', 'calendar', '--image-id', 'imageDigest=' + c.image_sha(digest))
        c.require(value.get('imageId', {}).get('imageDigest') == digest, 'ECR_SCAN_IMAGE_BINDING')
        status = value.get('imageScanStatus', {}).get('status')
        if status == 'COMPLETE':
            counts = value.get('imageScanFindings', {}).get('findingSeverityCounts')
            c.require(isinstance(counts, dict) and all(type(n) is int and n >= 0 for n in counts.values()), 'ECR_SCAN_COUNTS')
            c.require(counts.get('HIGH', 0) == 0 and counts.get('CRITICAL', 0) == 0 and counts.get('UNDEFINED', 0) == 0, 'ECR_VULNERABILITIES')
            return
        c.require(status in ('PENDING', 'IN_PROGRESS') and time.monotonic() < deadline, 'ECR_SCAN_INCOMPLETE')
        time.sleep(10)


def local_image(image, source):
    raw = g.command(['docker', 'image', 'inspect', image])
    values = c.decode(raw); c.require(len(values) == 1, 'LOCAL_IMAGE_COUNT')
    metadata = values[0]
    c.require(metadata.get('Architecture') == 'arm64' and metadata.get('Os') == 'linux' and metadata.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == source, 'LOCAL_IMAGE_SOURCE_PLATFORM')
    with tempfile.TemporaryDirectory(prefix='calendar-image-config-') as temporary:
        archive = Path(temporary) / 'image.tar'
        g.command(['docker', 'image', 'save', '--output', str(archive), image])
        c.require(archive.stat().st_size <= 512 * 1024 * 1024, 'IMAGE_ARCHIVE_SIZE')
        with tarfile.open(archive) as tar:
            manifests = c.decode(tar.extractfile('manifest.json').read())
            c.require(len(manifests) == 1, 'LOCAL_IMAGE_MANIFEST')
            entry = tar.getmember(manifests[0]['Config'])
            c.require(entry.isfile() and entry.size <= 1024 * 1024, 'LOCAL_CONFIG_FILE')
            config_raw = tar.extractfile(entry).read()
            image_config = c.decode(config_raw)
            c.require(image_config.get('architecture') == 'arm64' and image_config.get('os') == 'linux', 'LOCAL_CONFIG_PLATFORM')
            config_digest = 'sha256:' + hashlib.sha256(config_raw).hexdigest()
    return metadata['Id'], config_digest


def prepare(source, image, report, smoke, out):
    g.current_main(source)
    c.require(image == 'calendar-candidate:' + source, 'LOCAL_IMAGE_TAG')
    scan_sha = scan_report(report, image)
    identity, config_digest = local_image(image, source)
    c.require(smoke.is_file() and not smoke.is_symlink() and smoke.stat().st_size < 65536, 'SMOKE_FILE')
    smoke_raw = smoke.read_bytes(); proof = c.decode(smoke_raw)
    expected_version = c.decode((c.ROOT / 'apps/calendar/package.json').read_bytes())['version']
    c.require(c.encode(proof) == c.encode({'schema': 'hasna.calendar-container-smoke.v1', 'image_id': identity, 'platform': 'linux/arm64', 'version': expected_version, 'cpus': '0.25', 'memory_mib': 512, 'port': 8080, 'migration_runs': 2, 'tls_verify_full': True, 'owned_record_read': 200, 'cross_tenant_read': 404, 'authentication_controls_passed': True, 'offline_version_passed': True}), 'SMOKE_PROOF')
    config = read_manifest(); state(config)
    run = g.run_id(os.environ.get('GITHUB_RUN_ID')); attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '')
    c.require(re.fullmatch(r'[1-9][0-9]{0,3}', attempt), 'RUN_ATTEMPT')
    tag = f'candidate-{source}-{run}-{attempt}'
    before = aws('ecr', 'batch-get-image', '--repository-name', 'calendar', '--image-ids', 'imageTag=' + tag)
    c.require(before.get('images') == [] and len(before.get('failures', [])) == 1 and before['failures'][0].get('failureCode') == 'ImageNotFound', 'IMMUTABLE_TAG_EXISTS_OR_UNCERTAIN')
    remote = config['ecr_repository_url'] + ':' + tag
    save(out, 'push-intent.json', {'source_commit': source, 'image_tag': tag, 'image_config_digest': config_digest})
    g.command(['docker', 'tag', image, remote]); g.command(['docker', 'push', remote])
    image_digest, registry_config = ecr_manifest(config, 'imageTag=' + tag)
    c.require(registry_config == config_digest, 'PUSHED_CONFIG_DRIFT')
    ecr_scan(image_digest, wait=True)
    c.require(c.encode(config) == c.encode(read_manifest()), 'PREPARE_MANIFEST_DRIFT')
    g.current_main(source)
    value = {'schema': 'hasna.calendar-candidate.v1', 'source_commit': source, 'candidate_run_id': run,
        'candidate_run_attempt': int(attempt), 'image_digest': image_digest, 'image_config_digest': config_digest,
        'manifest_configuration_sha256': c.configuration_digest(config),
        'migration_0003_sha256': hashlib.sha256((c.ROOT / 'apps/calendar/migrations/0003_tenant_boundary.sql').read_bytes()).hexdigest(),
        'image_tag': tag, 'platform': 'linux/arm64', 'smoke_proof_sha256': hashlib.sha256(smoke_raw).hexdigest(), 'vulnerability_report_sha256': scan_sha}
    g.validate_candidate(value, source, run, int(attempt))
    save(out / 'candidate', 'candidate.json', value)


def reconcile(source, out):
    g.current_main(source)
    config = read_manifest(); service = read_service(config)
    arn = c.validate_service(service, config, stable=False); task = read_task(arn)
    baseline = c.baseline(service, task, config, stable=False)
    stable = False; observed = []
    try:
        c.validate_service(service, config)
        observed = running(config, service, baseline['image_digest']); stable = True
    except ValueError:
        pass  # Observation only: an unstable rollout must remain inspectable.
    safe_baseline = {k: v for k, v in baseline.items() if k != 'task_definition'}
    safe_baseline['task_definition_sha256'] = hashlib.sha256(baseline['task_definition'].encode()).hexdigest()
    automatic = service.get('deploymentConfiguration', {}).get('deploymentCircuitBreaker', {}).get('rollback')
    save(out, 'reconciled.json', {'schema': 'hasna.calendar-reconciliation.v1', 'source_commit': source,
        'recorded_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'manifest_configuration_sha256': c.configuration_digest(config), 'baseline': safe_baseline,
        'baseline_sha256': c.digest(baseline),
        'running_task_hashes': observed, 'automatic_circuit_breaker_rollback': automatic,
        'stable_running_state_verified': stable,
        'running_count': service.get('runningCount'), 'pending_count': service.get('pendingCount'),
        'rollout_states': [row.get('rolloutState') for row in service.get('deployments', [])],
        'activation_receipt_present': config['activation_receipt'] is not None,
        'enrollment_proof_created': False, 'production_mutations': 0})


def fresh_admission(source, candidate, candidate_sha):
    g.current_main(source)
    config = read_manifest()
    service, task, baseline, observed = state(config, activate=True)
    c.activation(config, candidate, candidate_sha, service, task)
    remote_digest, remote_config = ecr_manifest(config, 'imageTag=' + candidate['image_tag'])
    c.require(remote_digest == candidate['image_digest'] and remote_config == candidate['image_config_digest'], 'CANDIDATE_REGISTRY_DRIFT')
    ecr_scan(remote_digest)
    # Registry reads can be slow. Repeat live state, fixed authority and TTL at
    # the end so an expired or revoked receipt never survives a long scan.
    g.current_main(source)
    fresh_service, fresh_task, _, _ = state(config, activate=True)
    fresh_config = read_manifest()
    c.require(c.encode(fresh_config) == c.encode(config), 'ADMISSION_AUTHORITY_DRIFT')
    c.activation(fresh_config, candidate, candidate_sha, fresh_service, fresh_task)
    return fresh_config, fresh_service, fresh_task


def promote(source, candidate_path, candidate_sha, out):
    c.require(candidate_path.is_file() and not candidate_path.is_symlink() and candidate_path.stat().st_size < 65536, 'CANDIDATE_FILE')
    raw = candidate_path.read_bytes(); c.require(hashlib.sha256(raw).hexdigest() == c.hex_sha(candidate_sha), 'CANDIDATE_BYTES')
    candidate = c.decode(raw)
    g.validate_candidate(candidate, source, candidate.get('candidate_run_id'), candidate.get('candidate_run_attempt'))
    config, service, task = fresh_admission(source, candidate, candidate_sha)
    before = c.task_payload(task); changed = copy.deepcopy(before)
    changed['containerDefinitions'][0]['image'] = config['ecr_repository_url'] + '@' + candidate['image_digest']
    c.require(changed != before, 'CANDIDATE_UNCHANGED')
    # Keep Describe metadata for eligibility validation; the registration payload
    # still contains only original request fields, with only the image changed.
    c.validate_task({**task, **changed}, config)
    save(out, 'register-intent.json', {'source_commit': source, 'candidate_receipt_sha256': candidate_sha,
        'candidate_task_sha256': c.digest(changed), 'baseline_task_sha256': c.digest(before), 'image_digest': candidate['image_digest']})
    request = copy.deepcopy(changed)
    if request.get('tags') == []: del request['tags']
    try:
        c.receipt_time(config['activation_receipt'])
        registered = aws('ecs', 'register-task-definition', body=request)
        arn = c.task_arn(registered.get('taskDefinition', {}).get('taskDefinitionArn'), config)
        registered_task = read_task(arn)
        c.require(c.encode(c.task_payload(registered_task)) == c.encode(changed), 'REGISTERED_TASK_DRIFT')
        c.validate_task(registered_task, config)
    except Exception:
        save(out, 'reconciliation-required.json', {'source_commit': source, 'candidate_receipt_sha256': candidate_sha,
            'image_digest': candidate['image_digest'], 'phase': 'registration', 'automatic_retry': False, 'automatic_rollback': False})
        raise
    save(out, 'registered.json', {'task_definition_sha256': hashlib.sha256(arn.encode()).hexdigest(), 'image_digest': candidate['image_digest']})
    try:
        fresh_config, fresh_service, fresh_task = fresh_admission(source, candidate, candidate_sha)
        c.require(c.encode(fresh_config) == c.encode(config) and c.encode(c.task_payload(fresh_task)) == c.encode(before), 'PRE_UPDATE_AUTHORITY_DRIFT')
        save(out, 'update-intent.json', {'before_task_sha256': c.digest(before), 'after_task_sha256': c.digest(changed),
            'target_desired_count': fresh_config['activation_receipt']['target_desired_count'], 'automatic_rollback': False})
        c.receipt_time(fresh_config['activation_receipt'])
        target_count = fresh_config['activation_receipt']['target_desired_count']
        aws('ecs', 'update-service', '--cluster', config['cluster'], '--service', config['service'], '--task-definition', arn, '--desired-count', str(target_count))
        deadline = time.monotonic() + 1200
        while True:
            live = read_service(config)
            c.require(live.get('taskDefinition') == arn and live.get('desiredCount') == target_count, 'POST_UPDATE_SERVICE_DRIFT')
            c.rollback_disabled(live)
            c.require(not any(v.get('rolloutState') == 'FAILED' for v in live.get('deployments', [])), 'DEPLOYMENT_FAILED')
            c.require(c.encode(read_manifest()) == c.encode(config), 'POST_UPDATE_MANIFEST_DRIFT')
            c.receipt_time(config['activation_receipt'])
            try:
                c.validate_service(live, config, activation=True)
                normalized = copy.deepcopy(live); normalized['taskDefinition'] = service['taskDefinition']; normalized['desiredCount'] = service['desiredCount']
                c.require(c.service_configuration_digest(normalized) == c.service_configuration_digest(service), 'POST_UPDATE_CONFIGURATION_DRIFT')
                observed = running(config, live, candidate['image_digest'])
                break
            except ValueError as error:
                if str(error) not in ('SERVICE_COUNTS', 'SERVICE_DEPLOYMENT', 'RUNNING_TASK_COUNT', 'RUNNING_TASK_DRIFT'): raise
            c.require(time.monotonic() < deadline, 'DEPLOYMENT_TIMEOUT')
            time.sleep(10)
        save(out, 'deployed.json', {'schema': 'hasna.calendar-deployed.v1', 'source_commit': source,
            'candidate_receipt_sha256': candidate_sha, 'image_digest': candidate['image_digest'],
            'registered_task_sha256': c.digest(changed), 'running_task_hashes': observed,
            'restored_desired_count': target_count,
            'manifest_configuration_sha256': c.configuration_digest(config), 'activation_receipt_sha256': c.digest(config['activation_receipt']),
            'automatic_rollback': False, 'migration_performed': False, 'credential_mutations': 0})
    except Exception:
        save(out, 'reconciliation-required.json', {'source_commit': source, 'candidate_receipt_sha256': candidate_sha,
            'image_digest': candidate['image_digest'], 'automatic_retry': False, 'automatic_rollback': False})
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=('scan', 'prepare', 'reconcile', 'promote'))
    parser.add_argument('--source', required=True); parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--image'); parser.add_argument('--scan', type=Path); parser.add_argument('--smoke', type=Path)
    parser.add_argument('--candidate', type=Path); parser.add_argument('--candidate-sha256')
    args = parser.parse_args(); os.umask(0o077)
    if args.phase == 'scan': scan_report(args.scan, args.image)
    elif args.phase == 'prepare': prepare(args.source, args.image, args.scan, args.smoke, args.out)
    elif args.phase == 'reconcile': reconcile(args.source, args.out)
    else: promote(args.source, args.candidate, args.candidate_sha256, args.out)
    print('Calendar ' + args.phase + ' completed')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        raise SystemExit('Calendar operation refused or requires reconciliation: ' + (str(error) if type(error) is ValueError else type(error).__name__))
