"""Exact paired KMS baseline identities; use the maintained secret-safe transport."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = 'hasna/apps'
WORKFLOW = '.github/workflows/emails-kms-baseline.yml'
INTENT_STEP = 'Persist paired KMS mutation intent'

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

promotion = load('kms_promotion', ROOT.parent / 'emails-search/promotion.py')
oldgate = load('kms_existing_gate', ROOT.parent / 'emails-search/gate.py')
public = load('kms_public', ROOT.parent / 'emails-current/public_proof.py')
require, aws, save, encode = promotion.require, promotion.aws, promotion.save, promotion.encode
gh = oldgate.gh

def digest(value):
    return hashlib.sha256(encode(value)).hexdigest()

def read(path):
    def unique(rows):
        result = {}
        for key, value in rows:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(Path(path).read_bytes(), object_pairs_hook=unique)

def contract():
    return read(ROOT / 'contract.json')

def source_gate(source):
    require(os.environ.get('GITHUB_REPOSITORY') == REPO and os.environ.get('GITHUB_REF') == 'refs/heads/main'
            and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch', 'MAIN_DISPATCH_ONLY')
    require(os.environ.get('GITHUB_WORKFLOW_REF') == REPO + '/' + WORKFLOW + '@refs/heads/main', 'CALLER_WORKFLOW')
    require(os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'REPLAY_REFUSED')
    require(re.fullmatch('[a-f0-9]{40}', source or '') and os.environ.get('GITHUB_SHA') == source, 'SOURCE_SHA')
    result = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, timeout=20)
    require(result.returncode == 0 and result.stdout.decode().strip() == source, 'CHECKOUT_SOURCE')
    require(gh('repos/' + REPO + '/git/ref/heads/main')['object']['sha'] == source, 'SUPERSEDED_SOURCE')
    runs = gh(f'repos/{REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&head_sha={source}&per_page=100')['workflow_runs']
    require(oldgate.admit_runs(runs, source), 'EXACT_MAIN_CI_REQUIRED')
