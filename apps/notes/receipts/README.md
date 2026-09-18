# Native SDK receipts

`scripts/native-sdk-receipt.py` describes the exact npm bytes of the
Foundation-only Swift SDK companion (`swift/**`, product `NotesLib`) so private
consumers can pin it by receipt instead of by a bare integrity string. It mirrors
`apps/recordings/scripts/native-core-receipt.py` (receipt schema 1, kind
`hasna.notes.native-sdk`). This directory is not part of the published package.

A receipt binds the package name and version, the archive URL, length, SHA-256
and SHA-512 SRI, the full public source revision, the `LICENSE`, and the complete
file inventory of `swift/**` with its tree digest: the SHA-256 of the sorted
records `path NUL octalMode NUL decimalBytes NUL sha256 LF`.

```sh
python3 -I -B scripts/native-sdk-receipt.py /path/to/notes-X.Y.Z.tgz \
  --source-revision <full 40-character public commit> \
  --output receipts/notes-X.Y.Z.prepared.json
```

The archive's native bytes, license and package version are compared with that
Git revision. After the separately authorized npm publication, run the same
command with `--verify-registry` and a new `…published.json` output name: that
read-only step compares the registry's version, tarball URL and integrity
metadata and the downloaded archive bytes with the reviewed archive before it
records `distribution.status: published`. A prepared receipt is never edited into
a published one, and an existing receipt file is never overwritten. The script
never publishes, installs or runs lifecycle scripts.

| Receipt | Source revision | SHA-256 of the receipt file |
| --- | --- | --- |
| `notes-0.6.2.published.json` | `5068873fc53412454c0a73698e4ea18ccec85c08` | `bd0ab0796a68c44e4383cf3944b2e6b48b604f48ce6a8c14f37876e37dbcac99` |
