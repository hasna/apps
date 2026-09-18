#!/usr/bin/env python3
"""Calendar promotion policy. Inputs are data; production authority is fixed SSM."""
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import uuid

PARAMETER = '/hasna/deploy/calendar'
REGION = 'us-east-1'
MANIFEST_FIELDS = {
    'schema', 'app', 'region', 'account_id', 'cluster', 'service', 'web_task_family',
    'web_container', 'ecr_repository_url', 'image_platform', 'public_base_url', 'health_url',
    'execution_role_arn', 'task_role_arn', 'task_cpu', 'task_memory', 'container_port',
    'subnets', 'security_groups', 'assign_public_ip', 'log_group', 'log_stream_prefix',
    'web_environment', 'web_secrets', 'activation_requires_reviewed_tenant_enrollment',
    'producer_migration_allowed', 'automatic_rollback_to_unscoped_runtime_allowed', 'activation_receipt',
}
TASK_INPUTS = {
    'family', 'taskRoleArn', 'executionRoleArn', 'networkMode', 'containerDefinitions',
    'volumes', 'placementConstraints', 'requiresCompatibilities', 'cpu', 'memory', 'tags',
    'pidMode', 'ipcMode', 'proxyConfiguration', 'inferenceAccelerators', 'ephemeralStorage',
    'runtimePlatform', 'enableFaultInjection',
}
SERVICE_CONFIGURATION = (
    'clusterArn', 'serviceArn', 'serviceName', 'taskDefinition', 'desiredCount', 'launchType',
    'capacityProviderStrategy', 'platformVersion', 'networkConfiguration', 'loadBalancers',
    'serviceRegistries', 'deploymentController', 'deploymentConfiguration',
    'enableExecuteCommand', 'schedulingStrategy', 'serviceConnectConfiguration',
    'vpcLatticeConfigurations', 'volumeConfigurations', 'healthCheckGracePeriodSeconds',
    'placementConstraints', 'placementStrategy', 'availabilityZoneRebalancing',
    'enableECSManagedTags', 'propagateTags',
)
PRIMARY_CONFIGURATION = ('launchType', 'capacityProviderStrategy', 'platformVersion',
    'networkConfiguration', 'serviceConnectConfiguration', 'volumeConfigurations',
    'vpcLatticeConfigurations', 'fargateEphemeralStorage')
ROOT = Path(__file__).resolve().parents[3]


def require(ok, reason):
    if not ok: raise ValueError(reason)


def fields(value, expected, code):
    require(isinstance(value, dict) and set(value) == set(expected), code)


def encode(value):
    # UTF-8, recursively sorted ASCII field names, compact separators, no floats.
    # This profile matches recursively sorted JSON.stringify in the producer.
    def check(item):
        if isinstance(item, dict):
            require(all(isinstance(k, str) and k.isascii() and not k.isdecimal() for k in item), 'CANONICAL_KEYS')
            for v in item.values(): check(v)
        elif isinstance(item, list):
            for v in item: check(v)
        else:
            require(item is None or type(item) in (str, int, bool), 'CANONICAL_VALUE')
            if type(item) is int: require(abs(item) <= 9007199254740991, 'CANONICAL_SAFE_INTEGER')
    check(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def decode(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: require(False, 'JSON_CONSTANT'))


def digest(value): return hashlib.sha256(encode(value)).hexdigest()

def hex_sha(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value), 'SHA256')
    return value


def image_sha(value):
    require(isinstance(value, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', value), 'IMAGE_DIGEST')
    return value


def source_sha(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value), 'SOURCE_SHA')
    return value


def configuration_digest(manifest):
    return digest({k: v for k, v in manifest.items() if k != 'activation_receipt'})


def manifest(value):
    fields(value, MANIFEST_FIELDS, 'MANIFEST_FIELDS')
    require(len(encode(value)) <= 4096, 'SSM_STANDARD_PARAMETER_SIZE')
    require(value['schema'] == 'hasna.calendar-deploy.v1' and value['app'] == 'calendar', 'MANIFEST_IDENTITY')
    require(value['region'] == REGION and re.fullmatch(r'[0-9]{12}', value['account_id']), 'MANIFEST_ACCOUNT_REGION')
    account = value['account_id']
    for name in ('cluster', 'service', 'web_task_family', 'web_container'):
        require(isinstance(value[name], str) and re.fullmatch(r'[A-Za-z0-9_-]{1,255}', value[name]), 'MANIFEST_TARGET')
    require(value['web_task_family'] == 'calendar-prod' and value['web_container'] == 'calendar', 'MANIFEST_CALENDAR_TARGET')
    require(value['ecr_repository_url'] == f'{account}.dkr.ecr.{REGION}.amazonaws.com/calendar', 'MANIFEST_REPOSITORY')
    require(value['image_platform'] == 'linux/arm64' and value['task_cpu'] == '256' and value['task_memory'] == '512' and type(value['container_port']) is int and value['container_port'] == 8080, 'MANIFEST_RUNTIME')
    require(value['public_base_url'] == 'https://api.hasna.com/calendar' and value['health_url'] == 'https://api.hasna.com/calendar/health', 'MANIFEST_PUBLIC_AUTHORITY')
    for key in ('execution_role_arn', 'task_role_arn'):
        role = value[key]
        require((key == 'task_role_arn' and role is None) or (isinstance(role, str) and re.fullmatch(r'arn:aws:iam::' + account + r':role/[A-Za-z0-9+=,.@_/-]+', role)), 'MANIFEST_ROLE')
    for key, prefix in [('subnets', 'subnet-'), ('security_groups', 'sg-')]:
        rows = value[key]
        require(isinstance(rows, list) and 1 <= len(rows) <= 16 and len(set(rows)) == len(rows) and all(re.fullmatch(prefix + r'[a-f0-9]{8,17}', row) for row in rows), 'MANIFEST_NETWORK')
    require(value['assign_public_ip'] in ('ENABLED', 'DISABLED'), 'MANIFEST_PUBLIC_IP')
    require(isinstance(value['log_group'], str) and re.fullmatch(r'/[A-Za-z0-9_./-]{1,255}', value['log_group']), 'MANIFEST_LOGS')
    require(isinstance(value['log_stream_prefix'], str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value['log_stream_prefix']), 'MANIFEST_LOGS')
    require(isinstance(value['web_environment'], dict) and all(re.fullmatch(r'[A-Z][A-Z0-9_]{0,127}', k) and isinstance(v, str) and len(v) <= 1024 for k, v in value['web_environment'].items()), 'MANIFEST_ENVIRONMENT')
    require(value['web_environment'].get('PORT') == '8080', 'MANIFEST_PORT')
    fields(value['web_secrets'], {'HASNA_CALENDAR_DATABASE_URL', 'HASNA_CALENDAR_API_SIGNING_KEY'}, 'MANIFEST_SECRET_NAMES')
    require(all(isinstance(v, str) and re.fullmatch(r'arn:aws:secretsmanager:' + REGION + ':' + account + r':secret:[A-Za-z0-9_/.+=@:-]+', v) for v in value['web_secrets'].values()), 'MANIFEST_SECRET_REFERENCES')
    require(value['activation_requires_reviewed_tenant_enrollment'] is True and value['producer_migration_allowed'] is False and value['automatic_rollback_to_unscoped_runtime_allowed'] is False, 'MANIFEST_AUTHORITY_BOUNDARY')
    return value


def task_payload(task):
    # DescribeTaskDefinition metadata may grow; only documented registration
    # inputs are ever forwarded. Unknown provider metadata is never an input.
    return {key: copy.deepcopy(value) for key, value in task.items() if key in TASK_INPUTS}


def task_arn(value, config):
    require(isinstance(value, str) and re.fullmatch(r'arn:aws:ecs:' + REGION + ':' + config['account_id'] + ':task-definition/' + re.escape(config['web_task_family']) + r':[1-9][0-9]*', value), 'TASK_ARN')
    return value


def named(rows, value_key):
    require(isinstance(rows, list) and all(isinstance(r, dict) and isinstance(r.get('name'), str) and isinstance(r.get(value_key), str) for r in rows), 'TASK_NAMED_ROWS')
    require(len({r['name'] for r in rows}) == len(rows), 'TASK_DUPLICATE_NAME')
    return {r['name']: r[value_key] for r in rows}


def validate_task(task, config):
    require(task.get('family') == config['web_task_family'] and task.get('cpu') == config['task_cpu'] and task.get('memory') == config['task_memory'], 'TASK_BUDGET')
    require(task.get('executionRoleArn') == config['execution_role_arn'], 'TASK_EXECUTION_ROLE')
    require((task.get('taskRoleArn') or None) == config['task_role_arn'], 'TASK_ROLE')
    require(task.get('networkMode') == 'awsvpc' and task.get('requiresCompatibilities') == ['FARGATE'], 'TASK_NETWORK_MODE')
    require(task.get('runtimePlatform') == {'cpuArchitecture': 'ARM64', 'operatingSystemFamily': 'LINUX'}, 'TASK_PLATFORM')
    containers = task.get('containerDefinitions')
    require(isinstance(containers, list) and len(containers) == 1 and containers[0].get('name') == config['web_container'], 'TASK_CONTAINER')
    web = containers[0]
    require(web.get('essential') is True and not web.get('privileged') and not web.get('command') and not web.get('entryPoint'), 'TASK_ENTRYPOINT')
    require(named(web.get('environment', []), 'value') == config['web_environment'] and named(web.get('secrets', []), 'valueFrom') == config['web_secrets'], 'TASK_CONFIGURATION')
    ports = web.get('portMappings', [])
    require(len(ports) == 1 and ports[0].get('containerPort') == 8080 and ports[0].get('hostPort', 8080) == 8080 and ports[0].get('protocol', 'tcp') == 'tcp', 'TASK_PORT')
    logs = web.get('logConfiguration', {})
    options = logs.get('options', {})
    require(logs.get('logDriver') == 'awslogs' and options.get('awslogs-group') == config['log_group'] and options.get('awslogs-region') == REGION and options.get('awslogs-stream-prefix') == config['log_stream_prefix'], 'TASK_LOGS')
    prefix = config['ecr_repository_url'] + '@'
    require(isinstance(web.get('image'), str) and web['image'].startswith(prefix), 'TASK_IMAGE_REPOSITORY')
    return image_sha(web['image'][len(prefix):])


def rollback_disabled(service):
    deployment = service.get('deploymentConfiguration', {})
    require(service.get('deploymentController', {}).get('type', 'ECS') == 'ECS'
        and deployment.get('strategy', 'ROLLING') == 'ROLLING' and not deployment.get('lifecycleHooks'), 'UNSUPPORTED_DEPLOYMENT_STRATEGY_OR_HOOKS')
    breaker = deployment.get('deploymentCircuitBreaker', {})
    require(breaker.get('enable') is True and breaker.get('rollback') is False, 'AUTOMATIC_CIRCUIT_BREAKER_ROLLBACK')
    alarms = deployment.get('alarms')
    require(alarms is None or (isinstance(alarms, dict) and alarms.get('rollback') is False), 'AUTOMATIC_ALARM_ROLLBACK')


def service_configuration_digest(service):
    value = {key: service[key] for key in SERVICE_CONFIGURATION if key in service}
    primary = [row for row in service.get('deployments', []) if row.get('status') == 'PRIMARY']
    require(len(primary) == 1, 'PRIMARY_DEPLOYMENT_CONFIGURATION')
    value['primary_deployment_configuration'] = {key: primary[0][key] for key in PRIMARY_CONFIGURATION if key in primary[0]}
    return digest(value)


def validate_service(service, config, activation=False, stable=True):
    require(service.get('serviceName') == config['service'] and service.get('status') == 'ACTIVE', 'SERVICE_IDENTITY')
    require(service.get('clusterArn') == f"arn:aws:ecs:{REGION}:{config['account_id']}:cluster/{config['cluster']}" and service.get('serviceArn') == f"arn:aws:ecs:{REGION}:{config['account_id']}:service/{config['cluster']}/{config['service']}", 'SERVICE_RESOURCE_BINDING')
    desired = service.get('desiredCount')
    require(type(desired) is int and 0 <= desired <= 100, 'SERVICE_DESIRED_COUNT')
    if stable: require(service.get('runningCount') == desired and service.get('pendingCount') == 0, 'SERVICE_COUNTS')
    task_arn(service.get('taskDefinition'), config)
    deployments = service.get('deployments', [])
    if stable: require(len(deployments) == 1 and deployments[0].get('status') == 'PRIMARY' and deployments[0].get('rolloutState') == 'COMPLETED' and deployments[0].get('taskDefinition') == service['taskDefinition'], 'SERVICE_DEPLOYMENT')
    network = service.get('networkConfiguration', {}).get('awsvpcConfiguration', {})
    require(set(network.get('subnets', [])) == set(config['subnets']) and set(network.get('securityGroups', [])) == set(config['security_groups']) and network.get('assignPublicIp') == config['assign_public_ip'], 'SERVICE_NETWORK')
    if activation: rollback_disabled(service)
    return service['taskDefinition']


def baseline(service, task, config, stable=True):
    validate_service(service, config, stable=stable)
    require(task.get('taskDefinitionArn') == service['taskDefinition'], 'REFERENCED_TASK_BINDING')
    image = validate_task(task, config)
    return {'task_definition': service['taskDefinition'], 'task_payload_sha256': digest(task_payload(task)),
            'service_configuration_sha256': service_configuration_digest(service), 'image_digest': image,
            'desired_count': service['desiredCount']}


def receipt_time(receipt, now=None):
    value = receipt.get('recorded_at')
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', value), 'RECEIPT_TIMESTAMP')
    stamp = datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    age = ((now or datetime.now(timezone.utc)) - stamp).total_seconds()
    maximum = receipt.get('max_age_seconds')
    require(type(maximum) is int and 1 <= maximum <= 86400 and 0 <= age <= maximum, 'RECEIPT_EXPIRED_OR_FUTURE')


def activation(config, candidate, candidate_sha, service, task, now=None):
    receipt = config.get('activation_receipt')
    fields(receipt, {'schema', 'recorded_at', 'max_age_seconds', 'source_commit', 'candidate_run_id',
        'candidate_receipt_sha256', 'image_digest', 'image_config_digest', 'manifest_configuration_sha256',
        'migration_0003_sha256', 'baseline', 'tenant_id', 'ownership', 'credentials', 'candidate_proof',
        'automatic_rollback_allowed', 'pre_quiesce_baseline_sha256', 'pre_quiesce_desired_count',
        'target_desired_count', 'quiescence_proof_sha256'}, 'ACTIVATION_RECEIPT_REQUIRED')
    require(receipt['schema'] == 'hasna.calendar-activation.v1', 'ACTIVATION_SCHEMA')
    receipt_time(receipt, now)
    for key in ('source_commit', 'candidate_run_id', 'image_digest', 'image_config_digest', 'manifest_configuration_sha256', 'migration_0003_sha256'):
        require(receipt[key] == candidate[key], 'ACTIVATION_CANDIDATE_BINDING')
    require(receipt['candidate_receipt_sha256'] == hex_sha(candidate_sha), 'ACTIVATION_ARTIFACT_BINDING')
    require(receipt['manifest_configuration_sha256'] == configuration_digest(config), 'ACTIVATION_MANIFEST_DRIFT')
    fields(receipt['baseline'], {'task_definition', 'task_payload_sha256', 'service_configuration_sha256', 'image_digest', 'desired_count'}, 'ACTIVATION_BASELINE_FIELDS')
    require(encode(receipt['baseline']) == encode(baseline(service, task, config)), 'ACTIVATION_LIVE_DRIFT')
    validate_service(service, config, activation=True)
    require(service['desiredCount'] == 0, 'ACTIVATION_REQUIRES_QUIESCED_SERVICE')
    hex_sha(receipt['pre_quiesce_baseline_sha256']); hex_sha(receipt['quiescence_proof_sha256'])
    require(type(receipt['pre_quiesce_desired_count']) is int and receipt['pre_quiesce_desired_count'] == 1
        and type(receipt['target_desired_count']) is int and receipt['target_desired_count'] == 1, 'ACTIVATION_RESTORATION_COUNT')
    require(receipt['automatic_rollback_allowed'] is False, 'ACTIVATION_ROLLBACK')
    tenant = receipt['tenant_id']
    require(isinstance(tenant, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', tenant), 'ACTIVATION_TENANT')
    if re.fullmatch(r'(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})', tenant):
        require(str(uuid.UUID(tenant)) == tenant, 'ACTIVATION_TENANT_CANONICAL')
    ownership = receipt['ownership']
    fields(ownership, {'state', 'census_sha256', 'assignment_proof_sha256'}, 'OWNERSHIP_FIELDS')
    require(ownership['state'] == 'assigned', 'OWNERSHIP_INCOMPLETE')
    hex_sha(ownership['census_sha256']); hex_sha(ownership['assignment_proof_sha256'])
    credential = receipt['credentials']
    fields(credential, {'state', 'signed_claims_verified', 'current_readback_verified', 'proof_sha256'}, 'CREDENTIAL_PROOF_FIELDS')
    require(credential['state'] == 'verified' and credential['signed_claims_verified'] is True and credential['current_readback_verified'] is True, 'CREDENTIAL_PROOF_REQUIRED')
    hex_sha(credential['proof_sha256'])
    proof = receipt['candidate_proof']
    fields(proof, {'state', 'traffic_closed', 'owned_record_sha256', 'proof_sha256', 'controls'}, 'CANDIDATE_PROOF_FIELDS')
    require(proof['state'] == 'passed' and proof['traffic_closed'] is True, 'CANDIDATE_PROOF_REQUIRED')
    hex_sha(proof['owned_record_sha256']); hex_sha(proof['proof_sha256'])
    require(encode(proof['controls']) == encode({'owned': 200, 'missing': 401, 'invalid': 401, 'untenanted': 403, 'unknown': 403, 'disabled': 403, 'cross_tenant': 404}), 'CANDIDATE_DENIAL_CONTROLS')
    return receipt
