#!/usr/bin/env python3
"""Credential-free, current-main admission and immutable candidate download."""
import argparse
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location('calendar_control', Path(__file__).with_name('control.py'))
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
REPO = 'hasna/apps'
WORKFLOW = '.github/workflows/calendar-promotion.yml'
CANDIDATE_FIELDS = {'schema', 'source_commit', 'candidate_run_id', 'candidate_run_attempt',
    'image_digest', 'image_config_digest', 'manifest_configuration_sha256', 'migration_0003_sha256',
    'image_tag', 'platform', 'smoke_proof_sha256', 'vulnerability_report_sha256'}


def command(args, limit=8 * 1024 * 1024):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=90)
    c.require(result.returncode == 0 and len(result.stdout) <= limit, 'GITHUB_READ_REFUSED')
    return result.stdout


def gh(path): return c.decode(command(['gh', 'api', path]))


def pages(path, key):
    values = []
    for page in range(1, 11):
        value = gh(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        rows = value.get(key)
        c.require(isinstance(rows, list), 'GITHUB_LIST_SHAPE')
        values.extend(rows)
        if len(rows) < 100: return values
    raise ValueError('GITHUB_PAGINATION_LIMIT')


def exact_ci_success(runs, source):
    return any(row.get('head_sha') == source and row.get('head_branch') == 'main'
        and row.get('event') == 'push' and row.get('status') == 'completed'
        and row.get('conclusion') == 'success' and row.get('name') == 'ci'
        and row.get('path') == '.github/workflows/ci.yml' for row in runs)


def current_main(source):
    c.source_sha(source)
    c.require(os.environ.get('GITHUB_REPOSITORY') == REPO, 'REPOSITORY')
    c.require(os.environ.get('GITHUB_REF') == 'refs/heads/main' and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch', 'MAIN_DISPATCH_ONLY')
    c.require(os.environ.get('GITHUB_SHA') == source, 'DISPATCH_SOURCE')
    c.require(command(['git', 'rev-parse', 'HEAD']).decode().strip() == source, 'CHECKOUT_SOURCE')
    c.require(gh(f'repos/{REPO}/git/ref/heads/main').get('object', {}).get('sha') == source, 'SUPERSEDED_SOURCE')
    runs = pages(f'repos/{REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha={source}', 'workflow_runs')
    c.require(exact_ci_success(runs, source), 'EXACT_MAIN_CI_REQUIRED')


def run_id(value):
    c.require(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,19}', value), 'CANDIDATE_RUN_ID')
    return value


def validate_candidate(value, source, run, attempt):
    c.fields(value, CANDIDATE_FIELDS, 'CANDIDATE_FIELDS')
    c.require(value['schema'] == 'hasna.calendar-candidate.v1' and value['source_commit'] == source, 'CANDIDATE_SOURCE')
    c.require(value['candidate_run_id'] == run_id(run) and type(value['candidate_run_attempt']) is int and value['candidate_run_attempt'] == attempt, 'CANDIDATE_RUN_BINDING')
    c.require(value['platform'] == 'linux/arm64', 'CANDIDATE_PLATFORM')
    for key in ('image_digest', 'image_config_digest'): c.image_sha(value[key])
    for key in ('manifest_configuration_sha256', 'migration_0003_sha256', 'smoke_proof_sha256', 'vulnerability_report_sha256'): c.hex_sha(value[key])
    expected_migration = hashlib.sha256((c.ROOT / 'apps/calendar/migrations/0003_tenant_boundary.sql').read_bytes()).hexdigest()
    c.require(value['migration_0003_sha256'] == expected_migration, 'CANDIDATE_MIGRATION')
    c.require(value['image_tag'] == f'candidate-{source}-{run}-{attempt}', 'CANDIDATE_TAG')
    return value


def extract_candidate(archive, expected_sha):
    c.hex_sha(expected_sha)
    c.require(len(archive) <= 262144, 'ARTIFACT_ARCHIVE_SIZE')
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        rows = z.infolist()
        c.require(len(rows) == 1 and rows[0].filename == 'candidate.json' and not rows[0].is_dir(), 'ARTIFACT_FILE_SET')
        row = rows[0]
        c.require(not stat.S_ISLNK(row.external_attr >> 16) and not (row.flag_bits & 1) and 0 < row.file_size <= 65536, 'ARTIFACT_FILE_TYPE_SIZE')
        raw = z.read(row)
    c.require(hashlib.sha256(raw).hexdigest() == expected_sha, 'CANDIDATE_ARTIFACT_DIGEST')
    return raw


def candidate(source, run, expected_sha, destination=None):
    run_id(run); c.hex_sha(expected_sha)
    metadata = gh(f'repos/{REPO}/actions/runs/{run}')
    c.require(metadata.get('head_sha') == source and metadata.get('head_branch') == 'main'
        and metadata.get('event') == 'workflow_dispatch' and metadata.get('status') == 'completed'
        and metadata.get('conclusion') == 'success' and metadata.get('path') == WORKFLOW
        and metadata.get('repository', {}).get('full_name') == REPO
        and metadata.get('head_repository', {}).get('full_name') == REPO, 'CANDIDATE_RUN_NOT_TRUSTED')
    attempt = metadata.get('run_attempt')
    c.require(type(attempt) is int and 1 <= attempt <= 10000, 'CANDIDATE_ATTEMPT')
    rows = pages(f'repos/{REPO}/actions/runs/{run}/artifacts', 'artifacts')
    artifacts = [r for r in rows if r.get('name') == 'calendar-candidate' and r.get('expired') is False]
    c.require(len(artifacts) == 1, 'CANDIDATE_ARTIFACT_COUNT')
    artifact = artifacts[0]
    c.require(type(artifact.get('id')) is int and artifact['id'] > 0 and type(artifact.get('size_in_bytes')) is int and 0 < artifact['size_in_bytes'] <= 262144, 'CANDIDATE_ARTIFACT_METADATA')
    raw = extract_candidate(command(['gh', 'api', f'repos/{REPO}/actions/artifacts/{artifact["id"]}/zip'], 262144), expected_sha)
    value = validate_candidate(c.decode(raw), source, run, attempt)
    if destination:
        destination.mkdir(mode=0o700)
        target = destination / 'candidate.json'
        with target.open('xb') as f:
            os.chmod(target, 0o600); f.write(raw)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--phase', required=True, choices=('prepare', 'reconcile', 'promote'))
    parser.add_argument('--candidate-run', default='')
    parser.add_argument('--candidate-sha256', default='')
    parser.add_argument('--download', type=Path)
    args = parser.parse_args()
    current_main(args.source)
    if args.phase == 'promote':
        candidate(args.source, args.candidate_run, args.candidate_sha256, args.download)
    else:
        c.require(not args.candidate_run and not args.candidate_sha256, 'UNUSED_CANDIDATE_INPUTS')
    print('Calendar exact-main source and artifact admission passed')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        raise SystemExit('Calendar admission refused: ' + (str(error) if type(error) is ValueError else type(error).__name__))
