#!/usr/bin/env python3
"""Authenticate exact prepared metadata and persist intent before AWS mutation."""
import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import time

spec = importlib.util.spec_from_file_location('kms_common', Path(__file__).with_name('common.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

def pages(path, key):
    rows = []
    for page in range(1, 101):
        batch = c.gh(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')[key]
        rows.extend(batch)
        if len(batch) < 100:
            return rows
    raise ValueError('HISTORY_LIMIT')

def unused():
    current = int(os.environ['GITHUB_RUN_ID'])
    for run in pages(f'repos/{c.REPO}/actions/workflows/emails-kms-baseline.yml/runs', 'workflow_runs'):
        if run['id'] == current:
            continue
        c.require(run['status'] == 'completed' and run.get('run_attempt') == 1, 'PRIOR_RUN_UNRESOLVED')
        jobs = pages(f'repos/{c.REPO}/actions/runs/{run["id"]}/jobs?filter=all', 'jobs')
        steps = [s for j in jobs for s in j.get('steps', []) if s.get('name') == c.INTENT_STEP]
        # Every preceding run must prove the immutable intent step was skipped.
        # Missing job/step history, expired evidence, cancellation and failed
        # intent upload are uncertainty, never permission to repeat a write.
        c.require(len(steps) == 1 and steps[0].get('conclusion') == 'skipped', 'PRIOR_INTENT_SPENT_OR_UNKNOWN')

def validate(plan, source, run_id):
    c.require(plan.get('schema') == 'emails.kms-baseline-prepared.v1'
              and plan.get('source') == source and plan.get('run') == str(run_id), 'PREPARED_IDENTITY')
    c.require(plan.get('contract') == c.contract(), 'PREPARED_CONTRACT')
    age = time.time() - plan.get('createdAt', 0)
    c.require(0 <= age <= c.contract()['maxAgeSeconds'], 'PREPARED_EXPIRED')
    c.require(isinstance(plan.get('publicVersion'), str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', plan['publicVersion']), 'PUBLIC_VERSION')
    c.require(set(plan.get('services', {})) == {'api', 'worker'}, 'PREPARED_PAIR')
    for target in ('api', 'worker'):
        row = plan['services'][target]
        c.require(row.get('desiredCount') == 1 and re.fullmatch('[a-f0-9]{64}', row.get('configurationSha256', '')), 'PREPARED_SERVICE')

def reviewed(source, run_id, expected, destination):
    c.require(re.fullmatch('[1-9][0-9]{0,19}', run_id or '') and re.fullmatch('[a-f0-9]{64}', expected or ''), 'REVIEW_BINDING')
    run = c.gh(f'repos/{c.REPO}/actions/runs/{run_id}')
    c.require(run.get('path') == c.WORKFLOW and run.get('head_sha') == source
              and run.get('head_branch') == 'main' and run.get('event') == 'workflow_dispatch'
              and run.get('status') == 'completed' and run.get('conclusion') == 'success'
              and run.get('run_attempt') == 1, 'PREPARED_RUN')
    artifacts = pages(f'repos/{c.REPO}/actions/runs/{run_id}/artifacts', 'artifacts')
    rows = [a for a in artifacts if a['name'] == 'emails-kms-baseline-prepared']
    c.require(len(rows) == 1 and not rows[0].get('expired'), 'PREPARED_ARTIFACT')
    destination.mkdir(mode=0o700)
    result = subprocess.run(['gh', 'run', 'download', run_id, '--repo', c.REPO, '--name', 'emails-kms-baseline-prepared', '--dir', str(destination)], capture_output=True, timeout=90)
    c.require(result.returncode == 0, 'PREPARED_DOWNLOAD')
    path = destination / 'prepared.json'
    c.require(path.is_file() and not path.is_symlink() and path.stat().st_size < 65536
              and set(x.name for x in destination.iterdir()) == {'prepared.json'}, 'PREPARED_FILE')
    c.require(hashlib.sha256(path.read_bytes()).hexdigest() == expected, 'PREPARED_DIGEST')
    plan = c.read(path)
    validate(plan, source, run_id)
    return plan

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--phase', choices=['kms_prepare', 'kms_execute'], required=True)
    p.add_argument('--source', required=True)
    p.add_argument('--run', default='')
    p.add_argument('--sha256', default='')
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    os.umask(0o077)
    c.source_gate(args.source)
    args.out.mkdir(mode=0o700)
    if args.phase == 'kms_execute':
        unused()
        plan = reviewed(args.source, args.run, args.sha256, args.out / 'reviewed')
        c.save(args.out / 'intent.json', {
            'schema': 'emails.kms-baseline-intent.v1', 'source': args.source,
            'run': os.environ['GITHUB_RUN_ID'], 'preparedRun': args.run,
            'preparedSha256': args.sha256, 'contract': c.contract(),
            'operations': ['register-api', 'register-worker', 'update-api', 'update-worker'],
            'rollback': {t: c.contract()[t]['taskDefinition'] for t in ('api', 'worker')},
            'automaticRetry': False, 'automaticRollback': False,
        })
    print('Exact-main paired KMS baseline admission passed; no AWS mutation')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is ValueError and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
        raise SystemExit('KMS baseline gate refused: ' + message)
