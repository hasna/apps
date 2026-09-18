#!/usr/bin/env python3
import hashlib
import copy
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('gate.py'))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)


class Admission(unittest.TestCase):
    def test_exact_ci_requires_main_push_workflow_and_success(self):
        row = {'head_sha': 'a' * 40, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success', 'name': 'ci', 'path': '.github/workflows/ci.yml'}
        self.assertTrue(g.exact_ci_success([row], 'a' * 40))
        for key, bad in [('head_sha', 'b' * 40), ('head_branch', 'feature'), ('event', 'pull_request'), ('status', 'in_progress'), ('conclusion', 'failure'), ('name', 'other'), ('path', '.github/workflows/other.yml')]:
            self.assertFalse(g.exact_ci_success([{**row, key: bad}], 'a' * 40))
        self.assertFalse(g.exact_ci_success([], 'a' * 40))

    def archive(self, name='candidate.json', data=b'{}', extra=False, symlink=False):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            info = zipfile.ZipInfo(name)
            if symlink: info.external_attr = 0o120777 << 16
            z.writestr(info, data)
            if extra: z.writestr('other.json', b'{}')
        return out.getvalue()

    def test_artifact_refuses_traversal_symlinks_extra_files_and_digest_drift(self):
        expected = hashlib.sha256(b'{}').hexdigest()
        self.assertEqual(g.extract_candidate(self.archive(), expected), b'{}')
        for archive in [self.archive('../candidate.json'), self.archive('/candidate.json'), self.archive(extra=True), self.archive(symlink=True), self.archive(data=b'x' * 65537)]:
            with self.assertRaises(ValueError): g.extract_candidate(archive, expected)
        with self.assertRaises(ValueError): g.extract_candidate(self.archive(), 'f' * 64)

    def test_run_identifiers_cannot_be_options_or_paths(self):
        self.assertEqual(g.run_id('123'), '123')
        for bad in ['--help', '../1', '0', '', '1\n2', 1, True]:
            with self.assertRaises(ValueError): g.run_id(bad)

    def test_current_main_requires_dispatch_checkout_live_tip_and_exact_ci(self):
        source = 'a' * 40
        env = {'GITHUB_REPOSITORY': 'hasna/apps', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_SHA': source}
        with patch.dict(os.environ, env, clear=True), patch.object(g, 'command', return_value=(source + '\n').encode()), patch.object(g, 'gh', return_value={'object': {'sha': source}}), patch.object(g, 'pages', return_value=[]), patch.object(g, 'exact_ci_success', return_value=True):
            g.current_main(source)
            for key, bad in [('GITHUB_REPOSITORY', 'other/apps'), ('GITHUB_REF', 'refs/heads/feature'), ('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_SHA', 'b' * 40)]:
                with patch.dict(os.environ, {key: bad}), self.assertRaises(ValueError): g.current_main(source)
            with patch.object(g, 'command', return_value=b'wrong'), self.assertRaises(ValueError): g.current_main(source)
            with patch.object(g, 'gh', return_value={'object': {'sha': 'b' * 40}}), self.assertRaises(ValueError): g.current_main(source)
            with patch.object(g, 'exact_ci_success', return_value=False), self.assertRaises(ValueError): g.current_main(source)

    def test_candidate_provenance_run_attempt_and_download_are_bound(self):
        source = 'a' * 40
        value = {'schema': 'hasna.calendar-candidate.v1', 'source_commit': source,
            'candidate_run_id': '123', 'candidate_run_attempt': 1,
            'image_digest': 'sha256:' + 'b' * 64, 'image_config_digest': 'sha256:' + 'c' * 64,
            'manifest_configuration_sha256': 'd' * 64,
            'migration_0003_sha256': hashlib.sha256((g.c.ROOT / 'apps/calendar/migrations/0003_tenant_boundary.sql').read_bytes()).hexdigest(),
            'image_tag': f'candidate-{source}-123-1', 'platform': 'linux/arm64',
            'smoke_proof_sha256': 'e' * 64, 'vulnerability_report_sha256': 'f' * 64}
        raw = g.c.encode(value) + b'\n'; sha = hashlib.sha256(raw).hexdigest()
        metadata = {'head_sha': source, 'head_branch': 'main', 'event': 'workflow_dispatch',
            'status': 'completed', 'conclusion': 'success', 'path': g.WORKFLOW,
            'repository': {'full_name': g.REPO}, 'head_repository': {'full_name': g.REPO}, 'run_attempt': 1}
        artifacts = [{'name': 'calendar-candidate', 'expired': False, 'id': 456, 'size_in_bytes': 2048}]
        with patch.object(g, 'gh', return_value=metadata), patch.object(g, 'pages', return_value=artifacts), patch.object(g, 'command', return_value=self.archive(data=raw)):
            with tempfile.TemporaryDirectory() as temp:
                directory = Path(temp) / 'reviewed'
                self.assertEqual(g.candidate(source, '123', sha, directory), value)
                self.assertEqual((directory / 'candidate.json').read_bytes(), raw)
                self.assertEqual((directory / 'candidate.json').stat().st_mode & 0o777, 0o600)
            for key, bad in [('head_sha', 'b' * 40), ('head_branch', 'other'), ('event', 'pull_request'), ('status', 'in_progress'), ('conclusion', 'failure'), ('path', '.github/workflows/other.yml'), ('repository', {'full_name': 'other/apps'}), ('head_repository', {'full_name': 'other/apps'}), ('run_attempt', 2), ('run_attempt', True)]:
                with patch.object(g, 'gh', return_value={**metadata, key: bad}), self.assertRaises(ValueError): g.candidate(source, '123', sha)
            for bad in [[], artifacts + artifacts, [{**artifacts[0], 'expired': True}], [{**artifacts[0], 'size_in_bytes': 262145}], [{**artifacts[0], 'id': True}]]:
                with patch.object(g, 'pages', return_value=bad), self.assertRaises(ValueError): g.candidate(source, '123', sha)
            for key, bad in [('migration_0003_sha256', '0' * 64), ('platform', 'linux/amd64'), ('image_tag', 'latest'), ('candidate_run_attempt', True)]:
                forged = {**copy.deepcopy(value), key: bad}; forged_raw = g.c.encode(forged)
                with patch.object(g, 'command', return_value=self.archive(data=forged_raw)), self.assertRaises(ValueError): g.candidate(source, '123', hashlib.sha256(forged_raw).hexdigest())


if __name__ == '__main__': unittest.main()
