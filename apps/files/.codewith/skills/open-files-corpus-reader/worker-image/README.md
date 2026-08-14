# Open Files Extraction Worker Image

This build context provides the archive-capable extraction worker used by
`open-files-corpus-reader`.

Build from the skill root, not from this subdirectory:

```bash
docker build \
  -f .codewith/skills/open-files-corpus-reader/worker-image/Dockerfile \
  -t open-files-extraction-worker:archive-tools \
  .codewith/skills/open-files-corpus-reader
```

Smoke the archive tools:

```bash
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m --cpus 1 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint /usr/local/bin/open-files-archive-tools-smoke \
  open-files-extraction-worker:archive-tools
```

Create static/Docker-access verification evidence:

```bash
python3 .codewith/skills/open-files-corpus-reader/scripts/verify_extraction_worker_image.py \
  --output .codewith/private-artifacts/extraction-worker-image-verification.json
```

Build the operator approval packet:

```bash
python3 .codewith/skills/open-files-corpus-reader/scripts/build_extraction_worker_image_approval_packet.py \
  --verification .codewith/private-artifacts/extraction-worker-image-verification.json \
  --output .codewith/private-artifacts/extraction-worker-image-approval-packet.json
```

When Docker access is available, run the build/smoke verifier and capture
worker inventory:

```bash
python3 .codewith/skills/open-files-corpus-reader/scripts/verify_extraction_worker_image.py \
  --build \
  --worker-tool-inventory-output .codewith/private-artifacts/extraction-worker-tool-inventory.json \
  --output .codewith/private-artifacts/extraction-worker-image-verification.json
```

Capture worker tool inventory for the readiness gate:

```bash
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m --cpus 1 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  open-files-extraction-worker:archive-tools \
  /opt/open-files/scripts/extraction_tool_inventory.py \
  > .codewith/private-artifacts/extraction-worker-tool-inventory.json
```

The smoke creates synthetic archives only. It does not read corpus files,
object keys, filenames, source refs, secrets, or extracted private content.
Worker runtime containers must run with Docker network disabled; package
installation network is limited to the image build step.
