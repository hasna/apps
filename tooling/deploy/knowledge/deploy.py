#!/usr/bin/env python3
"""Knowledge exact-image deployment; credentials and database bytes stay in ECS."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.error
import urllib.request


def require(ok, code):
    if not ok:
        raise ValueError(code)


def reviewed_migrations():
    raw = Path(__file__).with_name('reviewed-migrations.json').read_bytes()
    value = json.loads(raw)
    require(value.get('schema') == 'knowledge.reviewed-migrations.v1' and
            value.get('policy') == 'reviewed-additive-nonce-v1', 'REVIEWED_MIGRATION_SCHEMA')
    require([m['id'] for m in value.get('migrations', [])] ==
            [f'knowledge_pg_{i}' for i in range(132, 137)], 'REVIEWED_MIGRATION_IDS')
    require(all(re.fullmatch(r'sha256:[0-9a-f]{64}', m.get('checksum', ''))
                for m in value['migrations']), 'REVIEWED_MIGRATION_CHECKSUMS')
    return value, hashlib.sha256(raw).hexdigest()


def validate_migration_policy(contract):
    policy = contract.get('migration_policy')
    if policy == 'no-pending-migrations':
        require(not contract.get('reviewed_migrations_sha256'), 'UNEXPECTED_MIGRATION_CONTRACT')
    else:
        require(policy == 'reviewed-additive-nonce-v1', 'MIGRATION_POLICY')
        _, expected = reviewed_migrations()
        require(contract.get('reviewed_migrations_sha256') == expected, 'REVIEWED_MIGRATION_CONTRACT')


def aws(*args):
    p = subprocess.run(['aws', *args, '--output', 'json'], capture_output=True, timeout=90)
    require(p.returncode == 0, 'AWS_' + args[0].upper() + '_REFUSED')
    return json.loads(p.stdout or b'{}')


def validate_manifest(value, account, region):
    expected = {'app': 'knowledge', 'account_id': account, 'region': region,
                'cluster': 'oss-fleet-prod', 'service': 'knowledge-prod',
                'web_task_family': 'knowledge-prod', 'web_container': 'knowledge',
                'migration_task_family': 'knowledge-prod-migrate', 'migration_container': 'knowledge-migrate',
                'ecr_repository_url': f'{account}.dkr.ecr.{region}.amazonaws.com/knowledge'}
    require(all(value.get(k) == v for k, v in expected.items()), 'MANIFEST_RESOURCE_IDENTITY')
    require(value.get('assign_public_ip') in ('ENABLED', 'DISABLED'), 'NETWORK_PUBLIC_IP')
    for key, pattern in [('subnets', r'subnet-[0-9a-f]+'), ('security_groups', r'sg-[0-9a-f]+')]:
        require(isinstance(value.get(key), list) and value[key] and
                all(re.fullmatch(pattern, x) for x in value[key]), 'NETWORK_' + key.upper())
    contract = value.get('knowledge_deploy', {})
    require(contract.get('schema') == 'knowledge.production-deploy.v1', 'DEPLOY_CONTRACT_REQUIRED')
    validate_migration_policy(contract)
    require(contract.get('legacy_owner_mode') == 'disabled', 'LEGACY_OWNER_MODE')
    require(not contract.get('legacy_owner_tenant_id'), 'LEGACY_OWNER_NOT_REVIEWED')
    require(contract.get('allow_service_quiescence') is True, 'QUIESCENCE_CONTRACT_REQUIRED')
    require(isinstance(contract.get('authority_id'), str) and contract['authority_id'], 'AUTHORITY_ID_REQUIRED')
    require(contract.get('authority_classification') == 'hasna_saas', 'AUTHORITY_CLASSIFICATION')
    require(re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', contract.get('backup_bucket', '')), 'BACKUP_BUCKET')
    require(contract.get('backup_prefix') == 'deployment-backups/knowledge', 'BACKUP_PREFIX')
    require(contract.get('client_key_secret_id') == 'hasna/oss/knowledge/api-key', 'CLIENT_KEY_REFERENCE')
    return value


def stable_service(value, expected_task=None, desired=None):
    require(value.get('status') == 'ACTIVE', 'SERVICE_NOT_ACTIVE')
    count = value.get('desiredCount')
    require(type(count) is int and count >= 1, 'SERVICE_DESIRED_COUNT')
    require(value.get('runningCount') == count and value.get('pendingCount') == 0, 'SERVICE_NOT_STABLE')
    if desired is not None:
        require(count == desired, 'SERVICE_DESIRED_DRIFT')
    if expected_task is not None:
        require(value.get('taskDefinition') == expected_task, 'SERVICE_TASK_DRIFT')
    deployments = value.get('deployments', [])
    require(len(deployments) == 1 and deployments[0].get('status') == 'PRIMARY' and
            deployments[0].get('rolloutState') == 'COMPLETED' and
            deployments[0].get('taskDefinition') == value.get('taskDefinition'), 'SERVICE_DEPLOYMENT_DRIFT')
    return value


def container(definition, name):
    rows = definition.get('containerDefinitions', [])
    require(len(rows) == 1 and rows[0].get('name') == name, 'CONTAINER_IDENTITY')
    return rows[0]


def check_authority(definition, name, contract):
    row = container(definition, name)
    env = {x['name']: x['value'] for x in row.get('environment', [])}
    require(env.get('HASNA_KNOWLEDGE_AUTHORITY_ID') == contract['authority_id'], 'TASK_AUTHORITY_ID')
    require(env.get('HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION') == contract['authority_classification'], 'TASK_AUTHORITY_CLASSIFICATION')
    require(not env.get('HASNA_KNOWLEDGE_LEGACY_OWNER_TENANT_ID'), 'TASK_UNVERIFIED_LEGACY_OWNER')
    require('HASNA_KNOWLEDGE_LEGACY_OWNER_TENANT_ID' not in {x['name'] for x in row.get('secrets', [])}, 'TASK_SECRET_OWNER_OVERRIDE')


def verify_database_secret_bindings(web, migrate):
    references = []
    for definition, name in ((web, 'knowledge'), (migrate, 'knowledge-migrate')):
        row = container(definition, name)
        key = 'HASNA_KNOWLEDGE_DATABASE_URL'
        require(key not in {x['name'] for x in row.get('environment', [])}, 'RUNTIME_DATABASE_ENV_OVERRIDE')
        secrets = [x['valueFrom'] for x in row.get('secrets', []) if x['name'] == key]
        require(len(secrets) == 1 and isinstance(secrets[0], str) and
                secrets[0].startswith('arn:aws:secretsmanager:'), 'RUNTIME_DATABASE_SECRET_REQUIRED')
        references.append(secrets[0])
    require(references[0] == references[1], 'RUNTIME_DATABASE_SECRET_MISMATCH')


def registration(definition, name, image, database_config=None):
    allowed = ('family', 'taskRoleArn', 'executionRoleArn', 'networkMode', 'containerDefinitions',
               'volumes', 'placementConstraints', 'requiresCompatibilities', 'cpu', 'memory',
               'pidMode', 'ipcMode', 'proxyConfiguration', 'inferenceAccelerators', 'ephemeralStorage', 'runtimePlatform')
    result = {k: copy.deepcopy(definition[k]) for k in allowed if k in definition}
    row = container(result, name)
    row['image'] = image
    row['environment'] = [e for e in row.get('environment', []) if e['name'] not in
                          ('HASNA_KNOWLEDGE_LEGACY_OWNER_TENANT_ID', 'HASNA_KNOWLEDGE_STORAGE_MODE', 'KNOWLEDGE_DEPLOY_CONFIG')]
    if database_config is not None:
        row['command'] = ['bun', 'deployment/database-phase.mjs']
        row['environment'].append({'name': 'KNOWLEDGE_DEPLOY_CONFIG', 'value': json.dumps(database_config, separators=(',', ':'))})
        row.pop('healthCheck', None)
    return result


def json_sha256(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def validate_reviewed_receipt(value, contract):
    reviewed, expected_hash = reviewed_migrations()
    validate_migration_policy(contract)
    migration = value.get('migration', {})
    require(migration.get('policy') == reviewed['policy'] and
            migration.get('reviewed_migrations_sha256') == expected_hash, 'RECEIPT_MIGRATION_CONTRACT')
    before, after, executed = (migration.get(k, {}) for k in ('before', 'after', 'executed'))
    ids = [m['id'] for m in reviewed['migrations']]
    require(before.get('pending_ids') in ([], ids) and before.get('pending') == len(before['pending_ids']), 'RECEIPT_PENDING_SET')
    require(executed == before and after.get('pending') == 0 and after.get('pending_ids') == [], 'RECEIPT_MIGRATION_EXECUTION')
    total = before.get('total')
    require(type(total) is int and total >= len(ids) and after.get('total') == total and
            after.get('already_applied') == total and before.get('already_applied') == total - before['pending'], 'RECEIPT_LEDGER_TOTAL')
    integrity = value['integrity']
    pre, post, proof = (integrity.get(k, {}) for k in ('pre', 'post', 'proof'))
    for snapshot in (pre, post):
        require(snapshot.get('sha256') == json_sha256({k: v for k, v in snapshot.items() if k != 'sha256'}), 'RECEIPT_SNAPSHOT_DIGEST')
        require(isinstance(snapshot.get('tables'), list) and snapshot['tables'] and
                isinstance(snapshot.get('functions'), list) and isinstance(snapshot.get('sequences'), list), 'RECEIPT_SNAPSHOT_SHAPE')
    require(proof.get('existing_domain_preserved') is True and proof.get('existing_ledger_preserved') is True and
            proof.get('runtime_permissions_verified') is True, 'RECEIPT_PRESERVATION_PROOF')
    for section, a, b in [('existing_domain', 'pre', 'post'), ('ledger', 'preserved_pre', 'preserved_post')]:
        hashes = proof.get(section, {})
        require(isinstance(hashes.get(a), str) and re.fullmatch(r'[0-9a-f]{64}', hashes[a]) and
                hashes.get(a) == hashes.get(b), 'RECEIPT_PRESERVATION_DIGEST')
    additions = before['pending'] > 0
    require(proof.get('exact_reviewed_additions') is additions, 'RECEIPT_ADDITION_MODE')
    if not additions:
        require(pre == post and all(proof.get(k) == [] for k in ('added_migrations', 'added_tables', 'added_functions')), 'RECEIPT_DOMAIN_DRIFT')
        return
    added = proof.get('added_migrations', [])
    require([{'id': m.get('id'), 'checksum': m.get('checksum')} for m in added] == reviewed['migrations'] and
            all(isinstance(m.get('applied_at'), str) and m['applied_at'] for m in added), 'RECEIPT_LEDGER_ADDITIONS')
    key = lambda row: (row.get('schema'), row.get('table'))
    pre_tables, post_tables = ({key(row): row for row in snapshot['tables']} for snapshot in (pre, post))
    require(len(pre_tables) == len(pre['tables']) and len(post_tables) == len(post['tables']), 'RECEIPT_DUPLICATE_TABLE')
    nonce = (reviewed['added_table']['schema'], reviewed['added_table']['name'])
    ledger = (reviewed['ledger']['schema'], reviewed['ledger']['table'])
    require(nonce not in pre_tables and set(post_tables) == set(pre_tables) | {nonce} and ledger in pre_tables, 'RECEIPT_TABLE_DELTA')
    for name, row in pre_tables.items():
        revised = post_tables[name]
        if name == ledger:
            require(row.get('schema_sha256') == revised.get('schema_sha256') and
                    revised.get('count') == row.get('count') + len(ids), 'RECEIPT_LEDGER_DELTA')
        else:
            require(row == revised, 'RECEIPT_DOMAIN_DRIFT')
    empty = post_tables[nonce]
    require(empty.get('count') == 0 and empty.get('sha256') == hashlib.sha256(b'').hexdigest() and
            proof.get('added_tables') == [empty], 'RECEIPT_NONCE_NOT_EMPTY')
    is_function = lambda fn: fn.get('schema') == reviewed['added_function']['schema'] and fn.get('name') == reviewed['added_function']['name']
    functions = [fn for fn in post['functions'] if is_function(fn)]
    require(not any(is_function(fn) for fn in pre['functions']) and len(functions) == 1 and functions[0].get('arguments') == '' and
            proof.get('added_functions') == functions and [fn for fn in post['functions'] if not is_function(fn)] == pre['functions'], 'RECEIPT_FUNCTION_DELTA')
    require(pre['sequences'] == post['sequences'] and pre.get('sequence_sha256') == post.get('sequence_sha256'), 'RECEIPT_SEQUENCE_DRIFT')


def validate_receipt(value, source, image_digest, bucket, prefix, contract=None):
    require(value.get('schema') == 'knowledge.database-deploy-receipt.v1' and value.get('success') is True, 'RECEIPT_SCHEMA')
    require(value.get('source') == source and value.get('image_digest') == image_digest, 'RECEIPT_SOURCE_IMAGE')
    require(value.get('legacy_owner_mode') == 'disabled', 'RECEIPT_OWNER_MODE')
    backup = value.get('backup', {})
    require(backup.get('bucket') == bucket and backup.get('key') == prefix + '/database.dump', 'RECEIPT_BACKUP_TARGET')
    require(isinstance(backup.get('version_id'), str) and backup['version_id'] not in ('', 'null'), 'RECEIPT_BACKUP_VERSION')
    require(re.fullmatch(r'[0-9a-f]{64}', backup.get('sha256', '')) and
            type(backup.get('bytes')) is int and backup['bytes'] > 0, 'RECEIPT_BACKUP_DIGEST')
    integrity = value.get('integrity', {})
    if contract and contract.get('migration_policy') == 'reviewed-additive-nonce-v1':
        validate_reviewed_receipt(value, contract)
        return value
    require(integrity.get('pre') == integrity.get('post') and isinstance(integrity.get('pre'), dict), 'RECEIPT_DOMAIN_DRIFT')
    require(re.fullmatch(r'[0-9a-f]{64}', integrity['pre'].get('sha256', '')), 'RECEIPT_DOMAIN_DIGEST')
    require(bool(integrity['pre'].get('tables')), 'RECEIPT_EMPTY_DOMAIN')
    for phase in ('before', 'after'):
        require(value.get('migration', {}).get(phase, {}).get('pending') == 0, 'RECEIPT_PENDING_MIGRATIONS')
    return value


class Deployment:
    def __init__(self):
        self.account = os.environ['AWS_ACCOUNT_ID']
        self.region = os.environ['AWS_REGION']
        self.source = os.environ['SOURCE_SHA']
        self.digest = os.environ['IMAGE_DIGEST']
        require(re.fullmatch(r'[0-9]{12}', self.account), 'ACCOUNT')
        require(re.fullmatch(r'[0-9a-f]{40}', self.source), 'SOURCE')
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', self.digest), 'DIGEST')
        self.root = Path(os.environ['RUNNER_TEMP']) / 'knowledge-deploy'
        self.root.mkdir(mode=0o700, exist_ok=True)
        self.manifest = validate_manifest(json.loads(aws('ssm', 'get-parameter', '--name', '/hasna/deploy/knowledge')['Parameter']['Value']), self.account, self.region)
        self.contract = self.manifest['knowledge_deploy']
        self.image = self.manifest['ecr_repository_url'] + '@' + self.digest
        self.quiesced = False
        self.new_task = None
        self.old_task = None
        self.desired = None
        self.database_task = None
        self.database_launch_attempted = False
        self.database_verified = False
        self.old_digest = None

    def service(self):
        result = aws('ecs', 'describe-services', '--cluster', self.manifest['cluster'], '--services', self.manifest['service'])
        require(not result.get('failures') and len(result.get('services', [])) == 1, 'SERVICE_READ')
        return result['services'][0]

    def file(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value)); path.chmod(0o600)
        return 'file://' + str(path)

    def wait_quiescent(self):
        for _ in range(120):
            current = self.service()
            require(current['taskDefinition'] == self.old_task and current['desiredCount'] == 0, 'QUIESCENCE_DRIFT')
            tasks = aws('ecs', 'list-tasks', '--cluster', self.manifest['cluster'], '--service-name', self.manifest['service'])['taskArns']
            if current['runningCount'] == 0 and current['pendingCount'] == 0 and not tasks:
                return
            time.sleep(5)
        raise ValueError('QUIESCENCE_TIMEOUT')

    def quiesce(self, prefix):
        self.quiesced = True
        self.file('phase-evidence.json', {'status': 'quiescence_requested', 'source_sha': self.source, 'image_digest': self.digest, 'previous_task_definition': self.old_task, 'previous_image_digest': self.old_digest, 'previous_desired_count': self.desired, 'database_receipt_prefix': prefix})
        aws('ecs', 'update-service', '--cluster', self.manifest['cluster'], '--service', self.manifest['service'], '--desired-count', '0')

    def run(self):
        require(aws('sts', 'get-caller-identity')['Account'] == self.account, 'AWS_ACCOUNT_IDENTITY')
        original = stable_service(self.service())
        self.old_task, self.desired = original['taskDefinition'], original['desiredCount']
        self.authenticated_proof()
        old = aws('ecs', 'describe-task-definition', '--task-definition', self.old_task)['taskDefinition']
        migrate = aws('ecs', 'describe-task-definition', '--task-definition', self.manifest['migration_task_family'])['taskDefinition']
        for task, name in ((old, 'knowledge'), (migrate, 'knowledge-migrate')):
            check_authority(task, name, self.contract)
            require(task.get('taskRoleArn') == f'arn:aws:iam::{self.account}:role/knowledge-prod-task', 'TASK_ROLE')
            require(task.get('executionRoleArn') == f'arn:aws:iam::{self.account}:role/knowledge-prod-exec', 'EXECUTION_ROLE')
        verify_database_secret_bindings(old, migrate)
        old_image = container(old, 'knowledge')['image']
        require(re.fullmatch(re.escape(self.manifest['ecr_repository_url']) + r'@sha256:[0-9a-f]{64}', old_image), 'ROLLBACK_IMAGE_MUST_BE_IMMUTABLE')
        self.old_digest = old_image.rsplit('@', 1)[1]
        require(old.get('family') == 'knowledge-prod' and migrate.get('family') == 'knowledge-prod-migrate', 'TASK_FAMILY')
        require(not aws('ecs', 'list-tasks', '--cluster', self.manifest['cluster'], '--family', 'knowledge-prod-migrate')['taskArns'], 'CONCURRENT_DATABASE_TASK')
        require(aws('s3api', 'get-bucket-versioning', '--bucket', self.contract['backup_bucket']).get('Status') == 'Enabled', 'BACKUP_VERSIONING')
        prefix = self.contract['backup_prefix'] + '/' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT'] + '/' + self.source
        database_config = {'schema': 'knowledge.database-deploy.v1', 'source': self.source,
                           'image_digest': self.digest, 'bucket': self.contract['backup_bucket'], 'prefix': prefix,
                           'legacy_owner_mode': 'disabled', 'migration_policy': self.contract['migration_policy']}
        if self.contract.get('reviewed_migrations_sha256'):
            database_config['reviewed_migrations_sha256'] = self.contract['reviewed_migrations_sha256']
        migration_definition = registration(migrate, 'knowledge-migrate', self.image, database_config)
        migration_task = aws('ecs', 'register-task-definition', '--cli-input-json', self.file('migration-task.json', migration_definition))['taskDefinition']['taskDefinitionArn']
        stable_service(self.service(), self.old_task, self.desired)
        # A recorded contract, not an inferred default, authorizes this short
        # maintenance window. Restoration is CAS-guarded in the exception path.
        self.quiesce(prefix)
        self.wait_quiescent()
        network = {'awsvpcConfiguration': {'subnets': self.manifest['subnets'], 'securityGroups': self.manifest['security_groups'], 'assignPublicIp': self.manifest['assign_public_ip']}}
        self.database_launch_attempted = True
        started = aws('ecs', 'run-task', '--cluster', self.manifest['cluster'], '--task-definition', migration_task,
                      '--launch-type', 'FARGATE', '--count', '1', '--client-token', 'knowledge-' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT'], '--network-configuration', self.file('network.json', network))
        require(not started.get('failures') and len(started.get('tasks', [])) == 1, 'DATABASE_TASK_LAUNCH')
        task_arn = started['tasks'][0]['taskArn']
        self.database_task = task_arn
        task = None
        for _ in range(180):
            result = aws('ecs', 'describe-tasks', '--cluster', self.manifest['cluster'], '--tasks', task_arn)
            require(not result.get('failures') and len(result.get('tasks', [])) == 1, 'DATABASE_TASK_READ')
            task = result['tasks'][0]
            if task.get('lastStatus') == 'STOPPED': break
            time.sleep(5)
        require(task and task.get('lastStatus') == 'STOPPED', 'DATABASE_TASK_TIMEOUT')
        require(task.get('taskDefinitionArn') == migration_task, 'DATABASE_TASK_DEFINITION')
        containers = task.get('containers', [])
        require(len(containers) == 1 and containers[0].get('exitCode') == 0 and containers[0].get('imageDigest') == self.digest, 'DATABASE_TASK_FAILED')
        receipt_path = self.root / 'database-receipt.json'
        aws('s3api', 'get-object', '--bucket', self.contract['backup_bucket'], '--key', prefix + '/receipt.json', str(receipt_path))
        receipt_path.chmod(0o600)
        receipt = validate_receipt(json.loads(receipt_path.read_text()), self.source, self.digest, self.contract['backup_bucket'], prefix, self.contract)
        self.database_verified = True
        self.wait_quiescent()
        definition = registration(old, 'knowledge', self.image)
        self.new_task = aws('ecs', 'register-task-definition', '--cli-input-json', self.file('web-task.json', definition))['taskDefinition']['taskDefinitionArn']
        self.wait_quiescent()
        aws('ecs', 'update-service', '--cluster', self.manifest['cluster'], '--service', self.manifest['service'], '--task-definition', self.new_task, '--desired-count', str(self.desired))
        self.wait_stable(self.new_task)
        self.public_proof()
        auth = self.authenticated_proof()
        proof = {'schema': 'knowledge.production-deploy-receipt.v1', 'source_sha': self.source,
                 'image_digest': self.digest, 'deployed_task_definition': self.new_task,
                 'previous_task_definition': self.old_task, 'database_task': task_arn,
                 'database_receipt_sha256': hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
                 'backup': receipt['backup'], 'legacy_owner_mode': 'disabled',
                 'domain_sha256': receipt['integrity']['post']['sha256'], 'authentication': auth, 'status': 'deployed_verified'}
        self.file('deploy-evidence.json', proof)
        self.quiesced = False
        print('KNOWLEDGE_DEPLOY_VERIFIED')

    def wait_stable(self, expected, digest=None):
        digest = digest or self.digest
        for _ in range(120):
            current = self.service()
            require(current['taskDefinition'] == expected and current['desiredCount'] == self.desired, 'ROLLOUT_DRIFT')
            try:
                stable_service(current, expected, self.desired)
                arns = aws('ecs', 'list-tasks', '--cluster', self.manifest['cluster'], '--service-name', self.manifest['service'])['taskArns']
                require(len(arns) == self.desired, 'RUNNING_TASK_COUNT')
                result = aws('ecs', 'describe-tasks', '--cluster', self.manifest['cluster'], '--tasks', *arns)
                require(not result.get('failures') and len(result.get('tasks', [])) == self.desired, 'RUNNING_TASK_READ')
                tasks = result['tasks']
                require(all(t['taskDefinitionArn'] == expected and t['lastStatus'] == 'RUNNING' and
                            len(t.get('containers', [])) == 1 and all(c.get('imageDigest') == digest for c in t['containers']) for t in tasks), 'RUNNING_IMAGE_DIGEST')
                return
            except ValueError:
                time.sleep(5)
        raise ValueError('ROLLOUT_TIMEOUT')

    def authenticated_proof(self):
        # Consume the reviewed key only through the exact shipped CLI and its
        # owner-only credentials provider. Neither command args nor logs carry it.
        key = aws('secretsmanager', 'get-secret-value', '--secret-id', self.contract['client_key_secret_id']).get('SecretString')
        require(isinstance(key, str) and key and '\n' not in key and '\r' not in key, 'CLIENT_KEY_FORMAT')
        credentials = self.root / 'credentials'
        credentials.write_text('HASNA_KNOWLEDGE_API_KEY=' + key + '\nHASNA_KNOWLEDGE_API_URL=https://api.hasna.com/knowledge\n')
        credentials.chmod(0o600)
        try:
            result = subprocess.run(['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}', '--env', 'HOME=/tmp/knowledge-cli',
                '--mount', 'type=bind,src=' + str(credentials) + ',dst=/tmp/knowledge-cli/.hasna/knowledge/config/credentials,readonly',
                '--entrypoint', 'bun', os.environ['LOCAL_IMAGE_REF'], 'bin/knowledge.js', 'auth', 'whoami', '--json'],
                capture_output=True, timeout=60)
            require(result.returncode == 0, 'AUTHENTICATED_CLI_PROBE')
            proof = json.loads(result.stdout)
            require(proof.get('ok') is True and proof.get('verified') is True and proof.get('probe') == 'live'
                    and proof.get('status') == 200 and proof.get('principal', {}).get('app') == 'knowledge', 'AUTHENTICATED_APP_PROOF')
            return {'kind': 'basic-cli-read', 'verified': True, 'status': 200, 'kid': proof['principal']['kid']}
            # Guarded tenant review is a separate proof using the reviewed vault key.
        finally:
            credentials.unlink(missing_ok=True)

    def public_proof(self):
        version = os.environ['PACKAGE_VERSION']
        for route in ('health', 'ready', 'version'):
            request = urllib.request.Request('https://api.hasna.com/knowledge/' + route, headers={'User-Agent': 'curl/8.0'})
            with urllib.request.urlopen(request, timeout=20) as response:
                value = json.load(response)
                require(response.status == 200 and value.get('version') == version and value.get('backend') == 'postgresql', 'PUBLIC_' + route.upper())
        try:
            urllib.request.urlopen(urllib.request.Request('https://api.hasna.com/knowledge/v1/notes', headers={'User-Agent': 'curl/8.0'}), timeout=20)
        except urllib.error.HTTPError as error:
            require(error.code == 401, 'ANONYMOUS_AUTH_REJECTION')
        else:
            raise ValueError('ANONYMOUS_AUTH_ACCEPTED')

    def recover(self):
        if not self.quiesced or not self.old_task: return
        require(not self.database_launch_attempted or self.database_verified, 'RECOVERY_DATABASE_OUTCOME_UNPROVEN')
        current = self.service()
        require(current['taskDefinition'] in (self.old_task, self.new_task), 'RECOVERY_TASK_DRIFT')
        require(current['desiredCount'] in (0, self.desired), 'RECOVERY_DESIRED_DRIFT')
        # A verified receipt proves no existing schema/data changed. Only the
        # exact reviewed additive nonce objects and ledger rows may be new;
        # the captured server starts without DDL and can use the old domain.
        # No database restore is performed automatically.
        aws('ecs', 'update-service', '--cluster', self.manifest['cluster'], '--service', self.manifest['service'], '--task-definition', self.old_task, '--desired-count', str(self.desired))
        self.wait_stable(self.old_task, self.old_digest)
        self.file('recovery-receipt.json', {'schema': 'knowledge.deploy-recovery.v1', 'task_definition': self.old_task, 'desired_count': self.desired, 'status': 'old_image_restored_verified'})


if __name__ == '__main__':
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(ValueError('DEPLOYMENT_TERMINATED')))
    deploy = None
    try:
        deploy = Deployment()
        deploy.run()
    except Exception as error:
        if deploy is not None:
            try: deploy.recover()
            except Exception as recovery_error:
                deploy.file('recovery-receipt.json', {'status': 'recovery_refused', 'code': str(recovery_error) if isinstance(recovery_error, ValueError) else type(recovery_error).__name__, 'database_task': deploy.database_task, 'previous_task_definition': deploy.old_task})
                print('KNOWLEDGE_DEPLOY_RECOVERY_REFUSED')
        print('KNOWLEDGE_DEPLOY_REFUSED:' + (str(error) if isinstance(error, ValueError) else type(error).__name__))
        raise SystemExit(1)
