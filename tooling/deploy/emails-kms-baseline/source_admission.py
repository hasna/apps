"""Admit unchanged KMS release inputs across authenticated main descendants."""
import hashlib
import json
import os
import re
import subprocess

# The KMS job runs Python stdlib + gh/aws only: no workspace install/build. The
# unchanged image and Emails' own package+lock freeze runtime dependencies.
# Whole directories also bind additions, deletions, file modes and subtrees.
BOUNDARY = (
    ('apps/emails', 'tree'),
    ('tooling/deploy/emails-kms-baseline', 'tree'),
    ('tooling/deploy/emails-search', 'tree'),
    ('tooling/deploy/emails-current', 'tree'),
    ('.github/workflows/emails-kms-baseline.yml', 'blob'),
    ('.github/workflows/emails-search-promotion-execute.yml', 'blob'),
    ('.github/workflows/ci.yml', 'blob'),
    ('tooling/ci/tests/standard/emails-kms-baseline.test.ts', 'blob'),
    ('tooling/ci/yaml.ts', 'blob'),
)


def require(ok, code):
    if not ok:
        raise ValueError(code)


def sha(value):
    require(isinstance(value, str) and re.fullmatch('[a-f0-9]{40}', value), 'SOURCE_COMMIT_FORMAT')
    return value


def git(*args):
    result = subprocess.run(['git', *args], capture_output=True, timeout=30)
    require(result.returncode == 0, 'SOURCE_GIT_READ')
    return result.stdout


def snapshot(source):
    source = sha(source)
    raw = git('ls-tree', '-z', source, '--', *(p for p, _ in BOUNDARY))
    entries = {}
    for row in raw.split(b'\0'):
        if not row:
            continue
        fields, path = row.decode().split('\t', 1)
        mode, kind, oid = fields.split()
        require(path not in entries, 'SOURCE_BOUNDARY_DUPLICATE')
        entries[path] = {'mode': mode, 'type': kind, 'sha': sha(oid)}
    validate_snapshot(entries)
    return entries


def validate_snapshot(entries):
    require(set(entries) == {p for p, _ in BOUNDARY}, 'SOURCE_BOUNDARY_MISSING')
    for path, kind in BOUNDARY:
        row = entries[path]
        require(row['type'] == kind and row['mode'] == ('040000' if kind == 'tree' else '100644'), 'SOURCE_BOUNDARY_TYPE')
        sha(row['sha'])


def remote_snapshot(gh, repo, source):
    source = sha(source)
    commit = gh(f'repos/{repo}/git/commits/{source}')
    require(commit.get('sha') == source, 'REMOTE_COMMIT_IDENTITY')
    root = sha(commit['tree']['sha'])
    cache = {}
    def tree(oid):
        if oid not in cache:
            response = gh(f'repos/{repo}/git/trees/{oid}')
            require(response.get('sha') == oid and response.get('truncated') is False, 'REMOTE_TREE_INCOMPLETE')
            rows = response.get('tree')
            require(isinstance(rows, list), 'REMOTE_TREE_SHAPE')
            cache[oid] = {r['path']: r for r in rows}
            require(len(cache[oid]) == len(rows), 'REMOTE_TREE_DUPLICATE')
        return cache[oid]
    entries = {}
    for path, _ in BOUNDARY:
        oid = root
        parts = path.split('/')
        for index, name in enumerate(parts):
            row = tree(oid).get(name)
            require(isinstance(row, dict), 'REMOTE_BOUNDARY_MISSING')
            if index < len(parts) - 1:
                require(row.get('type') == 'tree' and row.get('mode') == '040000', 'REMOTE_BOUNDARY_PARENT')
            oid = sha(row['sha'])
        entries[path] = {k: row[k] for k in ('mode', 'type', 'sha')}
    validate_snapshot(entries)
    return entries


def ancestor(gh, repo, before, after):
    sha(before); sha(after)
    if before == after:
        return
    comparison = gh(f'repos/{repo}/compare/{before}...{after}')
    require(comparison.get('status') == 'ahead'
            and comparison.get('merge_base_commit', {}).get('sha') == before, 'SOURCE_NOT_MAIN_ANCESTOR')
    # Never use compare.files/commits: those lists can be truncated.


def fingerprint(entries):
    return hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_receipt(value, source):
    require(isinstance(value, dict) and set(value) == {'schema', 'source', 'observedMain', 'ci', 'boundarySha256'}, 'SOURCE_ADMISSION_SHAPE')
    require(value['schema'] == 'emails.kms-source-admission.v1' and value['source'] == source, 'SOURCE_ADMISSION_IDENTITY')
    sha(source); sha(value['observedMain'])
    ci = value['ci']
    require(isinstance(ci, dict) and set(ci) == {'run', 'attempt', 'source'}, 'CI_ANCHOR_SHAPE')
    require(isinstance(ci['run'], str) and re.fullmatch('[1-9][0-9]{0,19}', ci['run']) and ci['attempt'] == 1, 'CI_ANCHOR_IDENTITY')
    sha(ci['source'])
    require(isinstance(value['boundarySha256'], str) and re.fullmatch('[a-f0-9]{64}', value['boundarySha256']), 'SOURCE_BOUNDARY_DIGEST')


def admit(gh, repo, source):
    source = sha(source)
    run_id = os.environ.get('KMS_CI_RUN_ID', '')
    require(re.fullmatch('[1-9][0-9]{0,19}', run_id), 'CI_ANCHOR_RUN_REQUIRED')
    run = gh(f'repos/{repo}/actions/runs/{run_id}')
    anchor = sha(run.get('head_sha'))
    require(str(run.get('id')) == run_id and run.get('run_attempt') == 1
            and run.get('repository', {}).get('full_name') == repo
            and run.get('head_repository', {}).get('full_name') == repo
            and run.get('name') == 'ci' and run.get('path') == '.github/workflows/ci.yml'
            and run.get('head_branch') == 'main' and run.get('event') == 'push'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success', 'CI_ANCHOR_NOT_SUCCESSFUL_MAIN')
    ancestor(gh, repo, anchor, source)
    expected = snapshot(anchor)
    require(snapshot(source) == expected, 'CI_ANCHOR_BOUNDARY_CHANGED')
    require(not git('status', '--porcelain', '--untracked-files=all', '--', *(p for p, _ in BOUNDARY)).strip(), 'SOURCE_BOUNDARY_DIRTY')
    current = sha(gh(f'repos/{repo}/git/ref/heads/main')['object']['sha'])
    ancestor(gh, repo, source, current)
    require(remote_snapshot(gh, repo, current) == expected, 'CURRENT_MAIN_BOUNDARY_CHANGED')
    result = {'schema': 'emails.kms-source-admission.v1', 'source': source, 'observedMain': current,
              'ci': {'run': run_id, 'attempt': 1, 'source': anchor}, 'boundarySha256': fingerprint(expected)}
    validate_receipt(result, source)
    return result


def prepared(gh, repo, previous, current):
    validate_receipt(previous, previous.get('source'))
    validate_receipt(current, current.get('source'))
    require(previous['ci'] == current['ci'] and previous['boundarySha256'] == current['boundarySha256'], 'PREPARED_SOURCE_ADMISSION_CHANGED')
    ancestor(gh, repo, previous['ci']['source'], previous['source'])
    ancestor(gh, repo, previous['source'], current['source'])
    require(fingerprint(snapshot(previous['source'])) == current['boundarySha256'], 'PREPARED_BOUNDARY_CHANGED')
