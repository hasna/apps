#!/usr/bin/env python3
"""Credential-free exact-delta, custody, ambiguity and workflow boundaries."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('kms_execute_tests', ROOT / 'execute.py')
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)
c, gate = e.c, e.gate


def fixtures():
    rules = copy.deepcopy(c.contract())
    tasks = {}
    for target in ('api', 'worker'):
        rule = rules[target]
        payload = {
            'family': rule['service'], 'taskRoleArn': c.promotion.TASK_ROLE,
            'executionRoleArn': c.promotion.EXEC_ROLE, 'networkMode': 'awsvpc',
            'requiresCompatibilities': ['FARGATE'], 'cpu': '256', 'memory': '512',
            'containerDefinitions': [{'name': rule['container'], 'image': rule['image'],
                'environment': [{'name': 'EXAMPLE_SETTING', 'value': 'synthetic'}],
                'secrets': [], 'command': ['synthetic-command'], 'essential': True}],
            'tags': [{'key': 'fixture', 'value': 'preserve'}],
        }
        if rule['healthCheck']:
            payload['containerDefinitions'][0]['healthCheck'] = {'command': ['CMD', 'true']}
        rule['baselineSha256'] = c.digest(payload)
        candidate = copy.deepcopy(payload)
        candidate['containerDefinitions'][0]['environment'] += [
            {'name': 'EMAILS_PROVIDER_KMS_KEY_ID', 'value': rules['keyArn']},
            {'name': 'EMAILS_PROVIDER_KMS_REGION', 'value': rules['region']},
        ]
        rule['candidateSha256'] = c.digest(candidate)
        raw = {k: v for k, v in payload.items() if k != 'tags'}
        raw.update(taskDefinitionArn=rule['taskDefinition'], status='ACTIVE', revision=int(rule['taskDefinition'].rsplit(':', 1)[1]))
        tasks[target] = {'taskDefinition': raw, 'tags': payload['tags']}
    return rules, tasks


class Baseline(unittest.TestCase):
    def setUp(self):
        self.rules, self.tasks = fixtures()
        self.contract = patch.object(c, 'contract', return_value=self.rules)
        self.contract.start()
        self.addCleanup(self.contract.stop)

    def test_only_two_settings_change_and_tags_roles_secrets_image_survive(self):
        for target in ('api', 'worker'):
            before = copy.deepcopy(self.tasks[target])
            after = e.candidate(before, target)
            self.assertEqual(c.digest(after), self.rules[target]['candidateSha256'])
            self.assertEqual(after['tags'], before['tags'])
            after['containerDefinitions'][0]['environment'] = after['containerDefinitions'][0]['environment'][:-2]
            original = c.promotion.task_payload(before['taskDefinition'])
            original['tags'] = before['tags']
            self.assertEqual(after, original)
            self.assertEqual(before, self.tasks[target])

    def test_wrong_baseline_and_unreviewed_fields_fail(self):
        for field, value in [('revision', 91), ('taskRoleArn', 'wrong'), ('family', 'other'), ('status', 'INACTIVE'), ('unknownField', True)]:
            task = copy.deepcopy(self.tasks['api'])
            task['taskDefinition'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                e.candidate(task, 'api')
        for kind in ['image', 'environment', 'secrets', 'command']:
            task = copy.deepcopy(self.tasks['worker'])
            task['taskDefinition']['containerDefinitions'][0][kind] = 'changed'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                e.candidate(task, 'worker')

    def test_duplicate_and_already_bound_settings_fail_even_with_recomputed_baseline(self):
        for rows in [
            [{'name': 'DUP', 'value': 'a'}, {'name': 'DUP', 'value': 'b'}],
            [{'name': 'EMAILS_PROVIDER_KMS_KEY_ID', 'value': 'already-set'}],
        ]:
            task = copy.deepcopy(self.tasks['api'])
            task['taskDefinition']['containerDefinitions'][0]['environment'] = rows
            payload = c.promotion.task_payload(task['taskDefinition']); payload['tags'] = task['tags']
            self.rules['api']['baselineSha256'] = c.digest(payload)
            with self.assertRaises(ValueError): e.candidate(task, 'api')

    def test_register_unknown_result_is_one_write_and_preserves_intent(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, GITHUB_RUN_ID='123'), \
             patch.object(e, 'reviewed', return_value={}), patch.object(e, 'recheck_pair'), \
             patch.object(e, 'task', return_value=self.tasks['api']), \
             patch.object(c, 'aws', side_effect=TimeoutError) as aws:
            with self.assertRaises(TimeoutError): e.register('api', 'a' * 40, Path(temp))
            self.assertEqual(aws.call_count, 1)
            self.assertTrue((Path(temp) / 'api-register-intent.json').is_file())
            self.assertFalse((Path(temp) / 'api-registered.json').exists())
            with self.assertRaises(FileExistsError): e.register('api', 'a' * 40, Path(temp))
            self.assertEqual(aws.call_count, 1)

    def test_register_records_arn_before_readback_and_never_updates(self):
        arn = self.rules['api']['taskDefinition'].rsplit(':', 1)[0] + ':91'
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, GITHUB_RUN_ID='123'), \
             patch.object(e, 'reviewed', return_value={}), patch.object(e, 'recheck_pair'), \
             patch.object(e, 'task', return_value=self.tasks['api']), \
             patch.object(c, 'aws', return_value={'taskDefinition': {'taskDefinitionArn': arn}}) as aws, \
             patch.object(e, 'registered', side_effect=ValueError('READBACK_FAILED')):
            with self.assertRaises(ValueError): e.register('api', 'a' * 40, Path(temp))
            self.assertEqual(aws.call_count, 1)
            self.assertEqual(aws.call_args.args[:2], ('ecs', 'register-task-definition'))
            self.assertEqual(c.read(Path(temp) / 'api-registered.json')['taskDefinition'], arn)

    def test_moved_service_blocks_before_registration(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(e, 'reviewed', return_value={}), \
             patch.object(e, 'recheck_pair', side_effect=ValueError('SERVICE_DRIFT')), patch.object(c, 'aws') as aws:
            with self.assertRaises(ValueError): e.register('api', 'a' * 40, Path(temp))
            aws.assert_not_called()

    def test_update_ambiguity_is_one_write_and_preserves_rollback_anchor(self):
        arn = self.rules['api']['taskDefinition'].rsplit(':', 1)[0] + ':91'
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, GITHUB_RUN_ID='123'), \
             patch.object(e, 'reviewed', return_value={}), patch.object(e, 'recheck_pair'), \
             patch.object(e, 'registered', return_value=arn), patch.object(c, 'aws', side_effect=TimeoutError) as aws:
            with self.assertRaises(TimeoutError): e.update('api', 'a' * 40, Path(temp))
            self.assertEqual(aws.call_count, 1)
            value = c.read(Path(temp) / 'api-update-intent.json')
            self.assertEqual(value['before'], self.rules['api']['taskDefinition'])
            self.assertFalse(value['automaticRollback'])

    def test_unhealthy_api_and_unknown_worker_health_are_distinguished(self):
        for target, health, accepted in [('api', 'UNKNOWN', False), ('api', 'HEALTHY', True), ('worker', 'UNKNOWN', True), ('worker', 'UNHEALTHY', False)]:
            rule = self.rules[target]
            task = {'taskArn': 'fixture', 'taskDefinitionArn': rule['taskDefinition'], 'lastStatus': 'RUNNING', 'healthStatus': health,
                    'containers': [{'name': rule['container'], 'imageDigest': rule['image'].split('@')[1]}]}
            with patch.object(c, 'aws', side_effect=[{'taskArns': ['fixture']}, {'tasks': [task]}]):
                if accepted:
                    proof = e.running(target, rule['taskDefinition']); self.assertEqual(proof['healthStatus'], health)
                else:
                    with self.assertRaises(ValueError): e.running(target, rule['taskDefinition'])

    def test_service_configuration_drift_is_bound_but_rollout_fields_are_not(self):
        row = {'desiredCount': 1, 'networkConfiguration': {'fixture': True}, 'taskDefinition': 'old', 'events': [], 'runningCount': 1, 'pendingCount': 0}
        changed = dict(row, taskDefinition='new', events=[{}], runningCount=2)
        self.assertEqual(e.service_config(row), e.service_config(changed))
        changed['desiredCount'] = 2
        self.assertNotEqual(e.service_config(row), e.service_config(changed))


class Gate(unittest.TestCase):
    def test_stale_or_wrong_source_plan_refused(self):
        contract = gate.c.contract()
        plan = {'schema': 'emails.kms-baseline-prepared.v2', 'source': 'a' * 40, 'sourceAdmission': {'schema': 'emails.kms-source-admission.v1', 'source': 'a' * 40, 'observedMain': 'a' * 40, 'ci': {'run': '10', 'attempt': 1, 'source': 'a' * 40}, 'boundarySha256': 'c' * 64}, 'run': '12',
                'createdAt': time.time(), 'contract': contract, 'publicVersion': '1.4.10',
                'services': {t: {'desiredCount': 1, 'configurationSha256': 'b' * 64} for t in ['api', 'worker']}}
        gate.validate(plan, 'a' * 40, '12')
        for change in [{'source': 'b' * 40}, {'run': '13'}, {'createdAt': 0}, {'contract': {}}, {'services': {}}]:
            with self.assertRaises(ValueError): gate.validate(dict(plan, **change), 'a' * 40, '12')

    def test_any_prior_intent_or_unknown_history_blocks_replay(self):
        run = {'id': 1, 'status': 'completed', 'run_attempt': 1}
        with patch.dict(os.environ, GITHUB_RUN_ID='2'):
            for conclusion in ['success', 'failure', 'cancelled', None]:
                jobs = [{'steps': [{'name': c.INTENT_STEP, 'conclusion': conclusion}]}]
                with patch.object(gate, 'pages', side_effect=[[run], jobs]), self.assertRaises(ValueError): gate.unused()
            with patch.object(gate, 'pages', side_effect=[[run], []]), self.assertRaises(ValueError): gate.unused()
            with patch.object(gate, 'pages', side_effect=[[run], [{'steps': [{'name': c.INTENT_STEP, 'conclusion': 'skipped'}]}]]): gate.unused()

    def test_workflow_uses_existing_trust_and_durable_custody_before_writes(self):
        root = ROOT.parents[2]
        workflow = (root / '.github/workflows/emails-search-promotion-execute.yml').read_text().split('\n  kms-baseline:', 1)[1]
        caller = (root / '.github/workflows/emails-kms-baseline.yml').read_text()
        self.assertIn('environment: production', workflow)
        self.assertIn('github.run_attempt == 1', workflow)
        self.assertIn('disable-retry: true', workflow)
        self.assertIn('emails-search-production', caller)
        self.assertIn('uses: ./.github/workflows/emails-search-promotion-execute.yml', caller)
        self.assertLess(workflow.index(c.INTENT_STEP), workflow.index('Assume existing trusted'))
        for first, receipt, second in [
            ('register-api exact', 'Persist register-api custody', 'register-worker exact'),
            ('register-worker exact', 'Persist register-worker custody', 'update-api exact'),
            ('update-api exact', 'Persist update-api custody', 'update-worker exact')]:
            self.assertLess(workflow.index(first), workflow.index(receipt)); self.assertLess(workflow.index(receipt), workflow.index(second))
        self.assertIn("always() && inputs.phase == 'kms_execute'", workflow)
        for forbidden in ['get-secret-value', 'kms:DescribeKey', 'deregister-task-definition', 'force-new-deployment', 'docker']:
            self.assertNotIn(forbidden, workflow)



class SourceAdmission(unittest.TestCase):
    def setUp(self):
        self.a, self.p, self.s, self.m = ['a'*40, 'b'*40, 'c'*40, 'd'*40]
        self.entries = {path: {'mode': '040000' if kind == 'tree' else '100644', 'type': kind, 'sha': 'e'*40} for path, kind in c.admission.BOUNDARY}
        self.run = {'id': 10, 'run_attempt': 1, 'head_sha': self.a, 'name': 'ci', 'path': '.github/workflows/ci.yml',
            'repository': {'full_name': c.REPO}, 'head_repository': {'full_name': c.REPO},
            'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success'}
        self.compare = {'status': 'ahead', 'merge_base_commit': {'sha': self.a}}
    def gh(self, path):
        if '/actions/runs/' in path: return self.run
        if '/git/ref/' in path: return {'object': {'sha': self.m}}
        if '/compare/' in path:
            before = path.split('/compare/')[1].split('...')[0]
            return {'status': 'ahead', 'merge_base_commit': {'sha': before}}
        raise AssertionError(path)
    def admitted(self, gh=None):
        with patch.dict(os.environ, KMS_CI_RUN_ID='10'), patch.object(c.admission, 'snapshot', return_value=self.entries), \
             patch.object(c.admission, 'remote_snapshot', return_value=self.entries), patch.object(c.admission, 'git', return_value=b''):
            return c.admission.admit(gh or self.gh, c.REPO, self.s)
    def test_successful_ci_ancestor_allows_unrelated_main_movement(self):
        receipt = self.admitted()
        self.assertEqual(receipt['ci'], {'run': '10', 'attempt': 1, 'source': self.a})
        self.assertEqual(receipt['source'], self.s)
        self.assertEqual(receipt['observedMain'], self.m)
    def test_nonmain_failed_pending_fork_or_rerun_ci_refuses(self):
        for change in [{'event':'pull_request'}, {'head_branch':'feature'}, {'conclusion':'failure'}, {'status':'in_progress'},
            {'run_attempt':2}, {'path':'.github/workflows/other.yml'}, {'id':11}, {'repository':{'full_name':'other/repo'}},
            {'head_repository':{'full_name':'fork/apps'}}]:
            with self.subTest(change=change):
                saved=self.run; self.run={**saved,**change}
                try:
                    with self.assertRaises(ValueError): self.admitted()
                finally:self.run=saved
    def test_changed_anchor_workflow_code_contract_or_email_deps_refuses(self):
        for path, _ in c.admission.BOUNDARY:
            changed=copy.deepcopy(self.entries);changed[path]['sha']='f'*40
            with self.subTest(path=path), patch.dict(os.environ,KMS_CI_RUN_ID='10'), \
                 patch.object(c.admission,'snapshot',side_effect=[self.entries,changed]), \
                 patch.object(c.admission,'remote_snapshot',return_value=self.entries), patch.object(c.admission,'git',return_value=b''):
                with self.assertRaisesRegex(ValueError,'CI_ANCHOR_BOUNDARY_CHANGED'):c.admission.admit(self.gh,c.REPO,self.s)
    def test_changed_current_main_dirty_source_and_divergence_refuse(self):
        changed=copy.deepcopy(self.entries);changed['apps/emails']['sha']='f'*40
        with patch.dict(os.environ,KMS_CI_RUN_ID='10'), patch.object(c.admission,'snapshot',return_value=self.entries), \
             patch.object(c.admission,'remote_snapshot',return_value=changed), patch.object(c.admission,'git',return_value=b''):
            with self.assertRaisesRegex(ValueError,'CURRENT_MAIN_BOUNDARY_CHANGED'):c.admission.admit(self.gh,c.REPO,self.s)
        with patch.dict(os.environ,KMS_CI_RUN_ID='10'), patch.object(c.admission,'snapshot',return_value=self.entries), patch.object(c.admission,'git',return_value=b' M changed'):
            with self.assertRaisesRegex(ValueError,'SOURCE_BOUNDARY_DIRTY'):c.admission.admit(self.gh,c.REPO,self.s)
        for status in ['behind','diverged','identical']:
            with self.subTest(status=status), self.assertRaises(ValueError):
                c.admission.ancestor(lambda _: {'status':status,'merge_base_commit':{'sha':self.a}},c.REPO,self.a,self.s)
    def test_remote_tree_is_complete_and_preserves_modes(self):
        for response in [{'sha':'e'*40,'truncated':True,'tree':[]}, {'sha':'f'*40,'truncated':False,'tree':[]}]:
            def gh(path):return {'sha':self.m,'tree':{'sha':'e'*40}} if '/commits/' in path else response
            with self.assertRaises(ValueError):c.admission.remote_snapshot(gh,c.REPO,self.m)
        changed=copy.deepcopy(self.entries);changed['.github/workflows/ci.yml']['mode']='120000'
        with self.assertRaisesRegex(ValueError,'SOURCE_BOUNDARY_TYPE'):c.admission.validate_snapshot(changed)
        changed.pop('apps/emails')
        with self.assertRaisesRegex(ValueError,'SOURCE_BOUNDARY_MISSING'):c.admission.validate_snapshot(changed)
    def test_complete_remote_tree_walk_matches_local_snapshot(self):
        nodes={'root':{}}
        for path, kind in c.admission.BOUNDARY:
            parent='root'
            parts=path.split('/')
            for i,part in enumerate(parts):
                key=parent+'/'+part
                if part not in nodes[parent]:
                    oid=format(len(nodes)+100, '040x')
                    nodes[parent][part]={'path':part,'sha':oid,'type':'tree' if i<len(parts)-1 else kind,
                        'mode':'040000' if i<len(parts)-1 or kind=='tree' else '100644'}
                    nodes[key]={}
                parent=key
        by_oid={format(99,'040x'):nodes['root']}
        for key,children in nodes.items():
            for name,row in children.items():by_oid[row['sha']]=nodes[key+'/'+name]
        def gh(path):
            if '/commits/' in path:return {'sha':self.m,'tree':{'sha':format(99,'040x')}}
            oid=path.rsplit('/',1)[1]
            return {'sha':oid,'truncated':False,'tree':list(by_oid[oid].values())}
        result=c.admission.remote_snapshot(gh,c.REPO,self.m)
        self.assertEqual(set(result),{p for p,_ in c.admission.BOUNDARY})
        for path,kind in c.admission.BOUNDARY:
            parent='root'
            for part in path.split('/'):
                expected=nodes[parent][part];parent+='/'+part
            self.assertEqual(result[path],{k:expected[k] for k in ('mode','type','sha')})

    def test_prepared_run_can_have_older_identical_main_source(self):
        current=self.admitted();previous={**current,'source':self.p,'observedMain':self.p}
        with patch.object(c.admission,'snapshot',return_value=self.entries):
            c.admission.prepared(self.gh,c.REPO,previous,current)
            for change in [{'boundarySha256':'f'*64},{'ci':{'run':'11','attempt':1,'source':self.a}}]:
                with self.assertRaises(ValueError):c.admission.prepared(self.gh,c.REPO,{**previous,**change},current)
    def test_source_gate_preserves_exact_dispatch_checkout_and_each_step_rechecks(self):
        env={'GITHUB_REPOSITORY':c.REPO,'GITHUB_REF':'refs/heads/main','GITHUB_EVENT_NAME':'workflow_dispatch',
             'GITHUB_WORKFLOW_REF':c.REPO+'/'+c.WORKFLOW+'@refs/heads/main','GITHUB_RUN_ATTEMPT':'1','GITHUB_SHA':self.s}
        with patch.dict(os.environ,env), patch.object(c.subprocess,'run',return_value=type('Result',(),{'returncode':0,'stdout':(self.s+'\n').encode()})()), \
             patch.object(c.admission,'admit',return_value={'fixture':True}) as admit:
            self.assertEqual(c.source_gate(self.s),{'fixture':True});admit.assert_called_once_with(c.gh,c.REPO,self.s)
        source=(ROOT/'execute.py').read_text()
        self.assertLess(source.index('admission = c.source_gate(args.source)'),source.index("c.aws('sts'"))
        self.assertIn('KMS_CI_RUN_ID: ${{ inputs.kms_ci_run_id }}',(ROOT.parents[2]/'.github/workflows/emails-search-promotion-execute.yml').read_text())

if __name__ == '__main__':
    unittest.main()
