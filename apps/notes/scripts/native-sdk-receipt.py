#!/usr/bin/env python3
"""Describe the reviewed npm bytes of the NotesLib Swift SDK; registry verification is an explicit read-only step.

Mirrors apps/recordings/scripts/native-core-receipt.py (receipt schema 1). The
receipt binds the exact archive, the full inventory and tree digest of swift/**,
the license, and the public source revision those bytes were verified against.
It never publishes, installs or runs package lifecycle scripts.
"""
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

PACKAGE = '@hasna/notes'
CORE = 'swift/'
REQUIRED = ('Sources/NotesLib/HTTPTransport.swift', 'Sources/NotesLib/Models.swift', 'Sources/NotesLib/NotesClient.swift')
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
        license_data = files['LICENSE'][0]
        for required in REQUIRED:
            if CORE + required not in files:
                raise ValueError('Required native source is missing')
        if (not re.search(r'\.library\(\s*name:\s*"NotesLib"\s*,\s*targets:\s*\["NotesLib"\]', manifest)
                or not re.search(r'swift-tools-version:\s*6\.0\b', manifest)
                or not re.search(r'\.macOS\(\s*\.v13\s*\)', manifest)):
            raise ValueError('Required Swift library or platform declaration is missing')
    except (KeyError, TypeError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('Invalid native package metadata') from error
    native = [{'path': path[len(CORE):], 'sha256': digest(data), 'bytes': len(data), 'mode': mode}
              for path, (data, mode) in sorted(files.items()) if path.startswith(CORE)]
    tree = ''.join(f"{f['path']}\0{f['mode']:o}\0{f['bytes']}\0{f['sha256']}\n" for f in native).encode()
    return {
        'schemaVersion': 1, 'kind': 'hasna.notes.native-sdk',
        'package': {'name': PACKAGE, 'version': version},
        'source': {'repository': 'https://github.com/hasna/apps', 'revision': revision},
        'distribution': {'status': 'prepared'},
        'archive': {'url': REGISTRY + '@hasna/notes/-/notes-' + version + '.tgz',
                    'bytes': len(blob), 'sha256': digest(blob),
                    'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(blob).digest()).decode()},
        'license': {'path': 'LICENSE', 'bytes': len(license_data), 'sha256': digest(license_data)},
        'native': {'packagePath': CORE.rstrip('/'), 'product': 'NotesLib',
                   'swiftToolsVersion': '6.0', 'minimumMacOS': '13.0',
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
    metadata = json.loads(fetch(REGISTRY + '@hasna%2Fnotes/' + version))
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
    prefix = 'apps/notes/' + CORE
    result = subprocess.run(['git', '-c', 'tar.umask=0022', 'archive', '--format=tar', revision, '--', prefix, 'apps/notes/package.json', 'apps/notes/LICENSE'],
                            cwd=repository, check=True, capture_output=True, timeout=30)
    with tarfile.open(fileobj=io.BytesIO(result.stdout), mode='r:') as archive:
        package = archive.extractfile('apps/notes/package.json')
        metadata = json.load(package) if package else {}
        if metadata.get('name') != PACKAGE or metadata.get('version') != receipt['package']['version']:
            raise ValueError('Package version differs from the public source revision')
        license_file = archive.extractfile('apps/notes/LICENSE')
        license_data = license_file.read() if license_file else b''
        if len(license_data) != receipt['license']['bytes'] or digest(license_data) != receipt['license']['sha256']:
            raise ValueError('License differs from the public source revision')
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
        raise SystemExit('Native SDK receipt verification failed; no receipt was produced.')
