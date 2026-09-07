#!/usr/bin/env python3
"""Describe reviewed npm bytes; registry verification is an explicit read-only step."""
import argparse
import base64
import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile
import urllib.request
from datetime import datetime, timezone

PACKAGE = '@hasna/recordings'
CORE = 'src/native/Recordings/'
REGISTRY = 'https://registry.npmjs.org/'
LIMIT = 128 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_archive(blob):
    if not blob or len(blob) > LIMIT:
        raise ValueError('Archive size is outside the allowed range')
    files = {}
    total = 0
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:*') as archive:
        for member in archive:
            parts = member.name.rstrip('/').split('/')
            if (len(seen) >= 20000 or member.name in seen or len(member.name) > 1024
                    or parts[0] != 'package' or any(p in ('', '.', '..') for p in parts)
                    or '\\' in member.name or any(ord(c) < 32 for c in member.name)
                    or not (member.isfile() or member.isdir())):
                raise ValueError('Archive contains an unsafe or duplicate entry')
            seen.add(member.name)
            if member.isdir():
                continue
            total += member.size
            if member.size > LIMIT or total > LIMIT * 2:
                raise ValueError('Expanded archive is too large')
            handle = archive.extractfile(member)
            if handle is None:
                raise ValueError('Archive member cannot be read')
            data = handle.read(member.size + 1)
            if len(data) != member.size:
                raise ValueError('Archive member is truncated')
            files['/'.join(parts[1:])] = (data, member.mode & 0o777)
    return files


def create_receipt(blob, revision):
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise ValueError('A full public source revision is required')
    files = read_archive(blob)
    try:
        package = json.loads(files['package.json'][0])
        version = package['version']
        if package['name'] != PACKAGE or not re.fullmatch(r'\d+\.\d+\.\d+', version):
            raise ValueError('Unexpected package identity')
        manifest = files[CORE + 'Package.swift'][0].decode()
        for required in ('Package.resolved', 'RecordingsLib/RecordingEngine.swift', 'RecordingsLib/RecordingProvider.swift'):
            if CORE + required not in files:
                raise ValueError('Required native source is missing')
        if (not re.search(r'\.library\(\s*name:\s*"RecordingsLib"\s*,\s*targets:\s*\["RecordingsLib"\]', manifest)
                or not re.search(r'swift-tools-version:\s*6\.2\b', manifest)
                or not re.search(r'\.macOS\(\s*\.v26\s*\)', manifest)):
            raise ValueError('Required Swift library or platform declaration is missing')
    except (KeyError, TypeError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('Invalid native package metadata') from error
    native = [{'path': path[len(CORE):], 'sha256': digest(data), 'bytes': len(data), 'mode': mode}
              for path, (data, mode) in sorted(files.items()) if path.startswith(CORE)]
    tree = ''.join(f"{f['path']}\0{f['mode']:o}\0{f['bytes']}\0{f['sha256']}\n" for f in native).encode()
    return {
        'schemaVersion': 1, 'kind': 'hasna.recordings.native-core',
        'package': {'name': PACKAGE, 'version': version},
        'source': {'repository': 'https://github.com/hasna/apps', 'revision': revision},
        'distribution': {'status': 'prepared'},
        'archive': {'url': REGISTRY + '@hasna/recordings/-/recordings-' + version + '.tgz',
                    'bytes': len(blob), 'sha256': digest(blob),
                    'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(blob).digest()).decode()},
        'native': {'packagePath': CORE.rstrip('/'), 'product': 'RecordingsLib',
                   'swiftToolsVersion': '6.2', 'minimumMacOS': '26.0',
                   'treeSHA256': digest(tree), 'files': native},
    }


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Registry redirects are not accepted')


def registry_bytes(url):
    if not url.startswith(REGISTRY):
        raise ValueError('Unexpected registry authority')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
    with opener.open(url, timeout=30) as response:
        data = response.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise ValueError('Registry response is too large')
        return data


def verify_registry(receipt, fetch=registry_bytes):
    version = receipt['package']['version']
    metadata = json.loads(fetch(REGISTRY + '@hasna%2Frecordings/' + version))
    if (metadata.get('name') != PACKAGE or metadata.get('version') != version
            or metadata.get('dist', {}).get('tarball') != receipt['archive']['url']
            or metadata.get('dist', {}).get('integrity') != receipt['archive']['integrity']):
        raise ValueError('Registry metadata differs from the reviewed archive')
    remote = fetch(receipt['archive']['url'])
    if len(remote) != receipt['archive']['bytes'] or digest(remote) != receipt['archive']['sha256']:
        raise ValueError('Registry archive differs from the reviewed bytes')
    receipt['distribution'] = {'status': 'published', 'registry': REGISTRY,
                               'verifiedAt': datetime.now(timezone.utc).isoformat()}


def verify_source(receipt, repository):
    revision = receipt['source']['revision']
    prefix = 'apps/recordings/' + CORE
    result = subprocess.run(['git', '-c', 'tar.umask=0022', 'archive', '--format=tar', revision, '--', prefix, 'apps/recordings/package.json'],
                            cwd=repository, check=True, capture_output=True, timeout=30)
    with tarfile.open(fileobj=io.BytesIO(result.stdout), mode='r:') as archive:
        package = archive.extractfile('apps/recordings/package.json')
        metadata = json.load(package) if package else {}
        if metadata.get('name') != PACKAGE or metadata.get('version') != receipt['package']['version']:
            raise ValueError('Package version differs from the public source revision')
        for expected in receipt['native']['files']:
            try:
                member = archive.getmember(prefix + expected['path'])
                handle = archive.extractfile(member)
                data = handle.read() if handle else b''
            except KeyError as error:
                raise ValueError('Native archive member is absent from the source revision') from error
            if (not member.isfile() or len(data) != expected['bytes'] or digest(data) != expected['sha256']
                    or member.mode & 0o777 != expected['mode']):
                raise ValueError('Native archive bytes differ from the public source revision')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=pathlib.Path)
    parser.add_argument('--source-revision', required=True)
    parser.add_argument('--repository', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[3])
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--verify-registry', action='store_true', help='Compare public registry bytes; does not publish')
    args = parser.parse_args()
    if args.archive.is_symlink() or not args.archive.is_file() or args.archive.stat().st_size > LIMIT:
        raise ValueError('Expected a regular bounded npm archive')
    blob = args.archive.read_bytes()
    receipt = create_receipt(blob, args.source_revision)
    verify_source(receipt, args.repository)
    if args.verify_registry:
        verify_registry(receipt)
    # Refuse replacement: a new verification writes a separate reviewable receipt.
    with args.output.open('x') as output:
        json.dump(receipt, output, indent=2)
        output.write('\n')
    print(json.dumps({'status': receipt['distribution']['status'], 'package': receipt['package'],
                      'archiveSHA256': receipt['archive']['sha256'], 'nativeTreeSHA256': receipt['native']['treeSHA256']}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Exception messages can contain local paths or registry/credential diagnostics.
        raise SystemExit('Native core receipt verification failed; no published receipt was produced.')
