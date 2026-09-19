#!/usr/bin/env python3
"""Prepare or execute four individually receipted, exact KMS-only ECS writes."""
import argparse
import copy
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import time

spec = importlib.util.spec_from_file_location('kms_common', Path(__file__).with_name('common.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
spec = importlib.util.spec_from_file_location('kms_gate', Path(__file__).with_name('gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
NAMES = {'EMAILS_PROVIDER_KMS_KEY_ID', 'EMAILS_PROVIDER_KMS_REGION'}


def candidate(response, target):
    rule = c.contract()[target]
    c.require(set(response) == {'taskDefinition', 'tags'}, 'TASK_RESPONSE')
    task = response['taskDefinition']
    c.require(set(task) <= (c.promotion.TASK_FIELDS | c.promotion.READ_ONLY_TASK_FIELDS), 'TASK_FIELDS')
    c.require(task.get('taskDefinitionArn') == rule['taskDefinition'] and task.get('status') == 'ACTIVE'
              and task.get('family') == rule['service'] and task.get('revision') == int(rule['taskDefinition'].rsplit(':', 1)[1]), 'BASELINE_REVISION')
    payload = c.promotion.task_payload(task)
    payload['tags'] = copy.deepcopy(response['tags'])
    c.require(c.digest(payload) == rule['baselineSha256'], 'BASELINE_DIGEST')
    c.require(payload.get('taskRoleArn') == c.promotion.TASK_ROLE and payload.get('executionRoleArn') == c.promotion.EXEC_ROLE
              and payload.get('networkMode') == 'awsvpc' and payload.get('requiresCompatibilities') == ['FARGATE'], 'TASK_AUTHORITY')
    rows = payload.get('containerDefinitions', [])
    c.require(len(rows) == 1 and rows[0].get('name') == rule['container'] and rows[0].get('image') == rule['image'], 'CONTAINER_IDENTITY')
    container = rows[0]
    c.require(('healthCheck' in container) == rule['healthCheck'], 'HEALTHCHECK_DRIFT')
    env, secrets = container.get('environment'), container.get('secrets')
    c.require(isinstance(env, list) and isinstance(secrets, list), 'CONTAINER_ENVIRONMENT')
    c.require(all(set(x) == {'name', 'value'} for x in env), 'ENVIRONMENT_SHAPE')
    env_names, secret_names = [x['name'] for x in env], [x['name'] for x in secrets]
    c.require(len(env_names) == len(set(env_names)) and len(secret_names) == len(set(secret_names)), 'DUPLICATE_SETTING')
    c.require(not (set(env_names) & set(secret_names)) and not (NAMES & (set(env_names) | set(secret_names))), 'KMS_ALREADY_BOUND')
    result = copy.deepcopy(payload)
    result['containerDefinitions'][0]['environment'].extend([
        {'name': 'EMAILS_PROVIDER_KMS_KEY_ID', 'value': c.contract()['keyArn']},
        {'name': 'EMAILS_PROVIDER_KMS_REGION', 'value': c.contract()['region']},
    ])
    c.require(c.digest(result) == rule['candidateSha256'], 'CANDIDATE_DIGEST')
    reverse = copy.deepcopy(result)
    reverse['containerDefinitions'][0]['environment'] = copy.deepcopy(env)
    c.require(reverse == payload, 'TWO_SETTING_DELTA')
    return result


def task(arn):
    return c.aws('ecs', 'describe-task-definition', '--task-definition', arn, '--include', 'TAGS')


def service(target):
    name = c.contract()[target]['service']
    result = c.aws('ecs', 'describe-services', '--cluster', c.promotion.CLUSTER, '--services', name)
    c.require(not result.get('failures') and len(result.get('services', [])) == 1, 'SERVICE_READ')
    row = result['services'][0]
    c.require(row.get('serviceName') == name and row.get('status') == 'ACTIVE' and row.get('desiredCount') == 1, 'SERVICE_IDENTITY')
    return row


def service_config(row):
    return c.digest({k: v for k, v in row.items() if k not in {
        'taskDefinition', 'deployments', 'events', 'runningCount', 'pendingCount',
    }})


def stable(row, arn):
    return (row.get('taskDefinition') == arn and row.get('runningCount') == row.get('desiredCount') == 1
            and row.get('pendingCount') == 0 and len(row.get('deployments', [])) == 1
            and row['deployments'][0].get('status') == 'PRIMARY'
            and row['deployments'][0].get('rolloutState') == 'COMPLETED'
            and row['deployments'][0].get('taskDefinition') == arn)


def running(target, arn):
    rule = c.contract()[target]
    ids = c.aws('ecs', 'list-tasks', '--cluster', c.promotion.CLUSTER, '--service-name', rule['service'], '--desired-status', 'RUNNING').get('taskArns', [])
    c.require(len(ids) == 1, 'RUNNING_COUNT')
    response = c.aws('ecs', 'describe-tasks', '--cluster', c.promotion.CLUSTER, '--tasks', *ids)
    c.require(not response.get('failures') and len(response.get('tasks', [])) == 1, 'RUNNING_READ')
    row = response['tasks'][0]
    containers = row.get('containers', [])
    health = row.get('healthStatus')
    c.require(row.get('taskDefinitionArn') == arn and row.get('lastStatus') == 'RUNNING'
              and len(containers) == 1 and containers[0].get('name') == rule['container']
              and containers[0].get('imageDigest') == rule['image'].split('@')[1], 'RUNNING_IDENTITY')
    c.require(health == 'HEALTHY' if rule['healthCheck'] else health in {'UNKNOWN', 'HEALTHY'}, 'RUNNING_HEALTH')
    return {'taskArnSha256': hashlib.sha256(row['taskArn'].encode()).hexdigest(),
            'taskDefinition': arn, 'image': rule['image'], 'healthStatus': health,
            'applicationHealthCheckConfigured': rule['healthCheck']}


def readiness(expected=None):
    version, ready = c.public.get('/version'), c.public.get('/ready')
    value = version.get('version')
    c.require(isinstance(value, str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', value), 'PUBLIC_VERSION')
    c.require(expected is None or value == expected, 'PUBLIC_VERSION_CHANGED')
    c.require(version.get('name') == 'emails' and version.get('mode') == 'self_hosted'
              and ready.get('status') == 'ready' and ready.get('version') == value
              and ready.get('pendingMigrations') == [] and ready.get('migrationIssues') == [], 'PUBLIC_NOT_READY')
    return value


def baseline_pair():
    result = {}
    for target in ('api', 'worker'):
        rule = c.contract()[target]
        row = service(target)
        c.require(stable(row, rule['taskDefinition']), 'BASELINE_SERVICE_MOVED')
        candidate(task(rule['taskDefinition']), target)
        proof = running(target, rule['taskDefinition'])
        result[target] = {'desiredCount': 1, 'configurationSha256': service_config(row), 'running': proof}
    return result


def prepare(source, out):
    before = baseline_pair()
    version = readiness()
    after = baseline_pair()
    c.require(before == after, 'PREPARATION_RACE')
    c.save(out / 'prepared.json', {
        'schema': 'emails.kms-baseline-prepared.v1', 'source': source,
        'run': os.environ['GITHUB_RUN_ID'], 'createdAt': int(time.time()),
        'contract': c.contract(), 'services': before, 'publicVersion': version,
        'effect': 'metadata only; no AWS writes',
    })


def reviewed(out, source):
    intent = c.read(out / 'intent.json')
    path = out / 'reviewed/prepared.json'
    c.require(intent.get('schema') == 'emails.kms-baseline-intent.v1' and intent.get('source') == source
              and intent.get('run') == os.environ['GITHUB_RUN_ID'] and intent.get('contract') == c.contract(), 'INTENT_IDENTITY')
    c.require(hashlib.sha256(path.read_bytes()).hexdigest() == intent['preparedSha256'], 'PREPARED_DIGEST')
    plan = c.read(path)
    gate.validate(plan, source, intent['preparedRun'])
    return plan


def registered(out, target):
    receipt = c.read(out / (target + '-registered.json'))
    rule = c.contract()[target]
    arn = receipt.get('taskDefinition', '')
    prefix = rule['taskDefinition'].rsplit(':', 1)[0] + ':'
    c.require(arn.startswith(prefix) and re.fullmatch('[1-9][0-9]*', arn[len(prefix):])
              and int(arn[len(prefix):]) > int(rule['taskDefinition'].rsplit(':', 1)[1]), 'REGISTERED_FAMILY')
    c.require(receipt.get('run') == os.environ['GITHUB_RUN_ID'] and receipt.get('candidateSha256') == rule['candidateSha256'], 'REGISTERED_RECEIPT')
    actual = task(arn)
    c.require(actual['taskDefinition'].get('status') == 'ACTIVE', 'REGISTERED_STATUS')
    payload = c.promotion.task_payload(actual['taskDefinition'])
    payload['tags'] = actual['tags']
    c.require(c.digest(payload) == rule['candidateSha256'], 'REGISTERED_PAYLOAD')
    return arn


def recheck_pair(plan, out, api_updated=False, worker_updated=False):
    for target, updated in [('api', api_updated), ('worker', worker_updated)]:
        arn = registered(out, target) if updated else c.contract()[target]['taskDefinition']
        row = service(target)
        c.require(stable(row, arn) and service_config(row) == plan['services'][target]['configurationSha256'], 'SERVICE_DRIFT')
        running(target, arn)
        if not updated:
            candidate(task(arn), target)
    readiness(plan['publicVersion'])


def register(target, source, out):
    plan = reviewed(out, source)
    recheck_pair(plan, out)
    payload = candidate(task(c.contract()[target]['taskDefinition']), target)
    if target == 'worker':
        registered(out, 'api')
    c.save(out / (target + '-register-intent.json'), {'run': os.environ['GITHUB_RUN_ID'],
        'before': c.contract()[target]['taskDefinition'], 'candidateSha256': c.contract()[target]['candidateSha256']})
    request = copy.deepcopy(payload)
    if request.get('tags') == []:
        del request['tags']
    response = c.aws('ecs', 'register-task-definition', body=request)
    # Persist returned custody before any follow-up API, including validation.
    c.save(out / (target + '-registered.json'), {'run': os.environ['GITHUB_RUN_ID'],
        'taskDefinition': response['taskDefinition']['taskDefinitionArn'],
        'candidateSha256': c.contract()[target]['candidateSha256']})
    registered(out, target)


def update(target, source, out):
    plan = reviewed(out, source)
    recheck_pair(plan, out, api_updated=(target == 'worker'))
    for member in ('api', 'worker'):
        registered(out, member)
    arn = registered(out, target)
    rule = c.contract()[target]
    c.save(out / (target + '-update-intent.json'), {'run': os.environ['GITHUB_RUN_ID'],
        'before': rule['taskDefinition'], 'after': arn, 'automaticRollback': False})
    c.aws('ecs', 'update-service', '--cluster', c.promotion.CLUSTER, '--service', rule['service'], '--task-definition', arn)
    deadline = time.monotonic() + 1200
    while True:
        row = service(target)
        c.require(row.get('taskDefinition') == arn and service_config(row) == plan['services'][target]['configurationSha256'], 'ROLLOUT_DRIFT')
        c.require(not any(x.get('rolloutState') == 'FAILED' for x in row.get('deployments', [])), 'ROLLOUT_FAILED')
        if stable(row, arn):
            break
        c.require(time.monotonic() < deadline, 'ROLLOUT_TIMEOUT')
        time.sleep(15)
    proof = running(target, arn)
    readiness(plan['publicVersion'])
    c.save(out / (target + '-updated.json'), {'run': os.environ['GITHUB_RUN_ID'],
        'taskBefore': rule['taskDefinition'], 'taskAfter': arn, 'running': proof,
        'publicVersion': plan['publicVersion'], 'automaticRollback': False})


def main():
    p = argparse.ArgumentParser()
    p.add_argument('operation', choices=['prepare', 'register-api', 'register-worker', 'update-api', 'update-worker', 'verify'])
    p.add_argument('--source', required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    os.umask(0o077)
    c.source_gate(args.source)
    c.require(c.aws('sts', 'get-caller-identity')['Account'] == c.promotion.ACCOUNT, 'AWS_ACCOUNT')
    c.require(args.out.is_dir(), 'OUTPUT_DIRECTORY')
    if args.operation == 'prepare':
        prepare(args.source, args.out)
    elif args.operation.startswith('register-'):
        register(args.operation.split('-')[1], args.source, args.out)
    elif args.operation.startswith('update-'):
        update(args.operation.split('-')[1], args.source, args.out)
    else:
        plan = reviewed(args.out, args.source)
        recheck_pair(plan, args.out, True, True)
        c.save(args.out / 'verified.json', {'schema': 'emails.kms-baseline-verified.v1',
            'run': os.environ['GITHUB_RUN_ID'], 'source': args.source,
            'tasks': {t: registered(args.out, t) for t in ('api', 'worker')},
            'rollback': {t: c.contract()[t]['taskDefinition'] for t in ('api', 'worker')},
            'imagesPreserved': True, 'onlyTwoKmsSettingsAdded': True,
            'publicVersion': plan['publicVersion'], 'workerApplicationHealthCheckConfigured': False,
            'automaticRollback': False})
    print('KMS baseline step completed; task environment and provider responses suppressed')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is ValueError and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
        raise SystemExit('KMS baseline stopped: ' + message + '; preserve custody and reconcile, never replay')
