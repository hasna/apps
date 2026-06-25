# `hasna-files-prod` Legacy Bucket Resolution

Date: 2026-06-08

`hasna-files-prod` was inspected as part of the Hasna XYZ open-files retirement
gates. The bucket is not the Google Drive archive source; it contained only two
small open-files smoke evidence objects from 2026-06-07.

The objects were copied into the canonical open-files bucket:

```txt
s3://hasna-xyz-opensource-files-prod/imports/legacy-buckets/hasna-files-prod-2026-06-08/raw/
```

Verification:

| Check | Result |
| --- | --- |
| Source objects | 2 |
| Source bytes | 109 |
| Target objects | 2 |
| Target bytes | 109 |
| Missing target keys | 0 |
| Extra target keys | 0 |
| Size mismatches | 0 |
| Byte checksum mismatches | 0 |

Private manifests were written under `/tmp` on the operator machine:

```txt
/tmp/hasna-files-prod-manifest-2026-06-08.tsv
/tmp/hasna-files-prod-bytecheck-2026-06-08/checksums.tsv
```

The legacy bucket should remain readable until rollback windows and global
legacy retirement gates close, but it is no longer a canonical runtime or
evidence target for new open-files writes.
