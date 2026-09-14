"""Apply a reviewed three-file source patch in memory, without fuzzy matching."""
import hashlib
import re

ALLOWED_PATHS = frozenset({
    'app/src/server/self-hosted/search-admission.ts',
    'app/src/server/self-hosted/serve.ts',
    'app/src/server/self-hosted/store.ts',
})
MAX_FILE_BYTES = 1024 * 1024
MAX_PATCH_BYTES = 1024 * 1024
HUNK = re.compile(rb'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\n')
SHA = re.compile(r'[0-9a-f]{64}')

class PatchRefusal(ValueError):
    pass

def require(condition, code):
    if not condition:
        raise PatchRefusal(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def apply_reviewed_patch(recipe, patch, preimages):
    """Return {archive_relative_path: new_bytes}; never read or write files."""
    require(isinstance(recipe, dict) and recipe.get('schema') == 'emails.source-overlay-recipe.v1', 'RECIPE_SCHEMA')
    files = recipe.get('files')
    require(isinstance(files, list) and len(files) == 3, 'RECIPE_FILE_COUNT')
    rows = {}
    for row in files:
        require(isinstance(row, dict) and row.get('path') in ALLOWED_PATHS and row['path'] not in rows, 'RECIPE_PATH')
        require(all(type(row.get(k)) is int for k in ('uid', 'gid', 'mode')) and row.get('uid') == 0 and row.get('gid') == 0 and row.get('mode') == 0o644, 'RECIPE_METADATA')
        for key in ('beforeSha256', 'afterSha256'):
            require(isinstance(row.get(key), str) and SHA.fullmatch(row[key]), 'RECIPE_HASH')
        for key in ('beforeBytes', 'afterBytes'):
            require(type(row.get(key)) is int and 0 < row[key] <= MAX_FILE_BYTES, 'RECIPE_FILE_BOUND')
        rows[row['path']] = row
    require(set(rows) == ALLOWED_PATHS and isinstance(preimages, dict) and set(preimages) == ALLOWED_PATHS, 'PREIMAGE_MEMBERSHIP')
    require(type(patch) is bytes and 0 < len(patch) <= MAX_PATCH_BYTES, 'PATCH_BOUND')
    require(digest(patch) == recipe.get('patchSha256'), 'PATCH_HASH')
    require(b'\x00' not in patch and b'\r' not in patch and patch.endswith(b'\n'), 'PATCH_ENCODING')
    for path, raw in preimages.items():
        row = rows[path]
        require(type(raw) is bytes and len(raw) == row['beforeBytes'] and len(raw) <= MAX_FILE_BYTES, 'PREIMAGE_BOUND')
        require(digest(raw) == row['beforeSha256'] and raw.endswith(b'\n'), 'PREIMAGE_HASH')
    lines = patch.splitlines(keepends=True)
    result = {}
    i = 0
    while i < len(lines):
        require(lines[i].startswith(b'--- a/'), 'FILE_HEADER')
        try:
            path = lines[i][6:-1].decode('ascii')
        except UnicodeError:
            raise PatchRefusal('FILE_PATH_ENCODING') from None
        require(path in rows and path not in result, 'FILE_PATH')
        i += 1
        require(i < len(lines) and lines[i] == b'+++ b/' + path.encode('ascii') + b'\n', 'FILE_NEW_PATH')
        i += 1
        old = preimages[path].splitlines(keepends=True)
        out = []
        cursor = 0
        hunks = 0
        while i < len(lines) and lines[i].startswith(b'@@'):
            match = HUNK.fullmatch(lines[i])
            require(match is not None, 'HUNK_HEADER')
            require(all(x is None or len(x) <= 7 for x in match.groups()), 'HUNK_NUMBER_BOUND')
            old_start, old_count, new_start, new_count = (int(x) if x is not None else 1 for x in match.groups())
            old_offset = old_start - 1 if old_count else old_start
            new_offset = new_start - 1 if new_count else new_start
            require(cursor <= old_offset <= len(old), 'HUNK_OLD_OFFSET')
            out.extend(old[cursor:old_offset])
            require(len(out) == new_offset, 'HUNK_NEW_OFFSET')
            cursor = old_offset
            old_seen = new_seen = 0
            i += 1
            while old_seen < old_count or new_seen < new_count:
                require(i < len(lines), 'HUNK_TRUNCATED')
                line = lines[i]
                require(line[:1] in (b' ', b'+', b'-') and line.endswith(b'\n'), 'HUNK_LINE')
                if line[:1] in (b' ', b'-'):
                    require(old_seen < old_count and cursor < len(old) and old[cursor] == line[1:], 'HUNK_CONTEXT')
                    cursor += 1
                    old_seen += 1
                if line[:1] in (b' ', b'+'):
                    require(new_seen < new_count, 'HUNK_NEW_COUNT')
                    out.append(line[1:])
                    new_seen += 1
                i += 1
            hunks += 1
        require(hunks > 0, 'FILE_WITHOUT_HUNKS')
        out.extend(old[cursor:])
        value = b''.join(out)
        require(len(value) == rows[path]['afterBytes'] and digest(value) == rows[path]['afterSha256'], 'POSTIMAGE_HASH')
        result[path] = value
    require(set(result) == ALLOWED_PATHS, 'PATCH_FILE_MEMBERSHIP')
    return result
